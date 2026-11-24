// ADR-316 — one PO takes PRs of ONE order (same SO, same JWSO, or all no
// order) and of the PO's vendor. Checked inside the save's transaction with the
// PR rows locked FOR UPDATE (CLAUDE.md §20.3), so a check can never pass on a
// PR that a parallel save is moving.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isPrVendorTbdText, prDifferentOrderMessage } from '@innovic/shared';
import { vendors } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { prOrderCodeSql, prOrderKeySql } from '../../lib/pr-order-key';

export interface PrOrderRow {
  id: string;
  code: string;
  orderKey: string;
  orderCode: string | null;
  vendorId: string | null;
  vendorCodeText: string | null;
  /** The code of the PR's FK vendor, when it has one. */
  vendorCode: string | null;
}

/** The PO header's vendor, as the comparison needs it. `code` upper-cased. */
export interface PoVendor {
  vendorId: string | null;
  code: string | null;
}

const norm = (t: string | null | undefined): string => (t ?? '').trim().toUpperCase();
const uniq = (ids: Array<string | null | undefined>): string[] => [
  ...new Set(ids.filter((x): x is string => !!x)),
];

/** The PR ids a PO's live lines hold AFTER mergeLines applies `input`: a line
 *  matched by id keeps its PR unless the payload sends one (null clears it); a
 *  line without a matching id is new; an existing line not sent is dropped. */
export function prIdsAfterSave(
  existing: ReadonlyArray<{ id: string; sourcePrId: string | null }>,
  input: ReadonlyArray<{ id?: string | null | undefined; sourcePrId?: string | null | undefined }>,
): string[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  return uniq(
    input.map((l) => {
      const kept = l.id ? byId.get(l.id) : undefined;
      if (kept && l.sourcePrId === undefined) return kept.sourcePrId;
      return l.sourcePrId ?? null;
    }),
  );
}

/** The first two PRs of different orders, or null when the save is allowed.
 *  A PO that already mixed orders before the save stays editable as long as
 *  the save brings in no order that was not on it already. */
export function findOrderClash(
  rows: readonly PrOrderRow[],
  beforePrIds: readonly string[],
  afterPrIds: readonly string[],
): { a: PrOrderRow; b: PrOrderRow } | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const after = uniq([...afterPrIds]).flatMap((id) => byId.get(id) ?? []);
  if (new Set(after.map((r) => r.orderKey)).size <= 1) return null;
  const beforeKeys = new Set(uniq([...beforePrIds]).flatMap((id) => byId.get(id)?.orderKey ?? []));
  const b = after.find((r) => !beforeKeys.has(r.orderKey));
  if (!b) return null;
  const a = after.find((r) => r.orderKey !== b.orderKey)!;
  return { a, b };
}

/** The first PR whose own vendor is not the PO's, or null. A blank / TBD PR
 *  fits any vendor; a vendor we cannot compare is left alone (po-form.tsx
 *  wrongVendorLines — a false block on a good line is worse). */
export function findVendorMismatch(rows: readonly PrOrderRow[], po: PoVendor): PrOrderRow | null {
  if (!po.vendorId && !po.code) return null;
  for (const r of rows) {
    if (r.vendorId && po.vendorId) {
      if (r.vendorId !== po.vendorId) return r;
      continue;
    }
    const text = r.vendorId ? norm(r.vendorCode) : norm(r.vendorCodeText);
    if (isPrVendorTbdText(text) || !po.code) continue;
    if (text !== po.code) return r;
  }
  return null;
}

/** One query for every PR named (no N+1), locked in id order. */
async function loadPrOrderRows(
  tx: DbTransaction,
  companyId: string,
  prIds: readonly string[],
): Promise<PrOrderRow[]> {
  const ids = uniq([...prIds]);
  if (ids.length === 0) return [];
  const res = await tx.execute(sql`
    SELECT pr.id, pr.code,
      ${prOrderKeySql('pr')} AS "orderKey",
      ${prOrderCodeSql('pr')} AS "orderCode",
      pr.vendor_id AS "vendorId", pr.vendor_code_text AS "vendorCodeText",
      v.code AS "vendorCode"
    FROM public.purchase_requests pr
    LEFT JOIN public.vendors v ON v.id = pr.vendor_id
    WHERE pr.company_id = ${companyId}::uuid
      AND pr.id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    ORDER BY pr.id
    FOR UPDATE OF pr
  `);
  return res as unknown as PrOrderRow[];
}

/** Refuse a save whose PRs span more than one order (create: beforePrIds = []). */
export async function assertPrsShareOneOrder(
  tx: DbTransaction,
  companyId: string,
  ids: { beforePrIds: readonly string[]; afterPrIds: readonly string[] },
): Promise<void> {
  if (uniq([...ids.afterPrIds]).length < 2) return;
  const rows = await loadPrOrderRows(tx, companyId, [...ids.beforePrIds, ...ids.afterPrIds]);
  const clash = findOrderClash(rows, ids.beforePrIds, ids.afterPrIds);
  if (clash) throw new ConflictError(prDifferentOrderMessage(clash.a, clash.b));
}

/** Resolve the header vendor: FK → its code; text only → the text itself. */
async function resolvePoVendor(
  tx: DbTransaction,
  companyId: string,
  header: { vendorId: string | null; vendorCodeText: string | null },
): Promise<PoVendor> {
  if (header.vendorId) {
    const rows = await tx
      .select({ code: vendors.code })
      .from(vendors)
      .where(
        and(
          eq(vendors.id, header.vendorId),
          eq(vendors.companyId, companyId),
          isNull(vendors.deletedAt),
        ),
      )
      .limit(1);
    return { vendorId: header.vendorId, code: norm(rows[0]?.code) || null };
  }
  return { vendorId: null, code: norm(header.vendorCodeText) || null };
}

/** Refuse a PR whose own vendor is not the PO's. `prIds` = the PRs to judge
 *  (create: all; edit: the newly added ones, or all after a vendor change). */
export async function assertPrsFitPoVendor(
  tx: DbTransaction,
  companyId: string,
  header: { vendorId: string | null; vendorCodeText: string | null },
  prIds: readonly string[],
): Promise<void> {
  if (uniq([...prIds]).length === 0) return;
  const po = await resolvePoVendor(tx, companyId, header);
  if (!po.vendorId && !po.code) return;
  const bad = findVendorMismatch(await loadPrOrderRows(tx, companyId, prIds), po);
  if (!bad) return;
  const prVendor = (bad.vendorId ? bad.vendorCode : bad.vendorCodeText)?.trim() || 'another vendor';
  throw new ConflictError(
    `PR ${bad.code} is for vendor ${prVendor} — this PO is for ${po.code ?? 'another vendor'}. ` +
      'Remove the line or change the vendor.',
  );
}
