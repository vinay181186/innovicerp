// ADR-252 — QC Dossier service: every QC report of one SO / JWSO, by POL
// (order line) and report folder. Read-only, plus signed links for a bulk
// download. The reads are dossier-sql.ts; the rules are dossier-build.ts.

import type {
  QcDossierOrderKind,
  QcDossierOrdersQuery,
  QcDossierOrdersResponse,
  QcDossierQuery,
  QcDossierResponse,
  QcDossierUrlsInput,
  QcDossierUrlsResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { signQcDossierFiles } from '../drawing-files/service';
import { buildDossier, type DossierBuilt, dossierPaths } from './dossier-build';
import { loadDossierRaw, loadOrderHead } from './dossier-sql';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** The built dossier of one order — the one entry point the Matrix and SO QC
 *  Status use too, so the three screens agree. */
export async function buildOrderDossier(
  tx: DbTransaction,
  cid: string,
  kind: QcDossierOrderKind,
  orderId: string,
): Promise<DossierBuilt> {
  return buildDossier(await loadDossierRaw(tx, cid, kind, orderId));
}

/** Order picker: SOs and JWSOs, not cancelled, newest first. */
export async function listQcDossierOrders(
  input: QcDossierOrdersQuery,
  user: AuthContext,
): Promise<QcDossierOrdersResponse> {
  await requireFormAccess(user, 'qcdocs_upload', 'view');
  const cid = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
    const soMatch = term
      ? sql`AND (o.code ILIKE ${term} ESCAPE '\\' OR o.internal_so_no ILIKE ${term} ESCAPE '\\'
                 OR o.customer_name ILIKE ${term} ESCAPE '\\')`
      : sql``;
    const jwMatch = term
      ? sql`AND (o.code ILIKE ${term} ESCAPE '\\' OR o.customer_name ILIKE ${term} ESCAPE '\\')`
      : sql``;
    const rs = (await tx.execute(sql`
      SELECT x.kind, x.id, x.code, x.internal_so_no, x.customer_name FROM (
        SELECT 'so' AS kind, o.id, o.code, o.internal_so_no, o.customer_name,
               o.so_date AS order_date, o.created_at
        FROM public.sales_orders o
        WHERE o.company_id = ${cid}::uuid AND o.deleted_at IS NULL AND o.status <> 'cancelled'
          ${soMatch}
        UNION ALL
        SELECT 'jwso', o.id, o.code, NULL::text, o.customer_name, o.jw_date, o.created_at
        FROM public.job_work_orders o
        WHERE o.company_id = ${cid}::uuid AND o.deleted_at IS NULL AND o.status <> 'cancelled'
          ${jwMatch}
      ) x
      ORDER BY x.order_date DESC NULLS LAST, x.created_at DESC, x.code DESC
      LIMIT ${input.limit}
    `)) as unknown as Array<Record<string, unknown>>;
    return {
      orders: rs.map((r) => ({
        kind: r['kind'] === 'jwso' ? ('jwso' as const) : ('so' as const),
        id: String(r['id']),
        code: String(r['code']),
        internalSoNo: (r['internal_so_no'] as string | null) ?? null,
        customerName: (r['customer_name'] as string | null) ?? null,
      })),
    };
  });
}

async function readDossier(
  tx: DbTransaction,
  cid: string,
  kind: QcDossierOrderKind,
  orderId: string,
): Promise<QcDossierResponse> {
  const head = await loadOrderHead(tx, cid, kind, orderId);
  if (!head) {
    throw new NotFoundError(
      `${kind === 'so' ? 'Sales Order' : 'JWSO'} not found. Refresh the page.`,
    );
  }
  const built = await buildOrderDossier(tx, cid, kind, orderId);
  return {
    order: { kind, ...head },
    lines: built.lines,
    totals: built.totals,
    unlinked: built.unlinked,
  };
}

export async function getQcDossier(
  input: QcDossierQuery,
  user: AuthContext,
): Promise<QcDossierResponse> {
  await requireFormAccess(user, 'qcdocs_upload', 'view');
  const cid = requireCompany(user);
  return withUserContext(user, (tx) => readDossier(tx, cid, input.kind, input.orderId));
}

/** Signed links for a bulk / ZIP download. Every path must be a file this
 *  order's dossier shows (computed here, never trusted from the browser);
 *  the drawing-download right decides, and every link handed out is logged. */
export async function getQcDossierUrls(
  input: QcDossierUrlsInput,
  user: AuthContext,
): Promise<QcDossierUrlsResponse> {
  await requireFormAccess(user, 'qcdocs_upload', 'view');
  const cid = requireCompany(user);
  const { dossier, paths } = await withUserContext(user, async (tx) => {
    const d = await readDossier(tx, cid, input.kind, input.orderId);
    return { dossier: d, paths: dossierPaths(d) };
  });
  const wanted = [...new Set(input.storagePaths.map((p) => p.trim()))];
  if (wanted.some((p) => !paths.has(p))) {
    throw new AuthorizationError('One or more files are not part of this order. Refresh the page.');
  }
  const names = new Map<string, string>();
  const collect = (f: { storagePath: string; fileName: string }) => {
    if (!names.has(f.storagePath)) names.set(f.storagePath, f.fileName);
  };
  dossier.unlinked.forEach(collect);
  for (const l of dossier.lines)
    for (const fo of l.folders) {
      fo.files.forEach(collect);
      for (const e of fo.entries) e.files.forEach(collect);
    }
  const urls = await signQcDossierFiles(
    wanted.map((p) => ({ path: p, fileName: names.get(p) ?? p })),
    dossier.order.code,
    user,
  );
  return { urls };
}
