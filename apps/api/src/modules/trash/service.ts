// Trash service — admin-only soft-delete recovery.
//
// Mirror of legacy renderTrash (HTML L11309) + restoreFromTrash (L2143).
// Legacy's permDeleteTrash / emptyTrash are deliberately NOT here: ADR-188
// removed permanent delete from the app (CLAUDE.md §6 rule 8 — hard deletes
// only via documented admin scripts after a backup). Legacy stored a `db.trash`
// array of cloned records; we don't need that — every entity carries its
// own `deleted_at` column, so trash is just a UNION ALL of soft-deleted
// rows across a curated set of tables.
//
// All operations admin-only. Restore clears `deleted_at` and `deleted_by`
// (ADR-197) and logs RESTORE against the document's own History. "Deleted
// By" reads `deleted_by`, falling back to `updated_by` for rows deleted
// before 0178 added the column.

import { ActivityAction, type ActivityEntity } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import {
  bomMasters,
  mlBoms,
  clients,
  costCenters,
  deliveryChallans,
  goodsReceiptNotes,
  items,
  jobCards,
  jobWorkOrders,
  machines,
  ncRegister,
  operators,
  productionOrders,
  purchaseOrders,
  purchaseRequests,
  qcProcesses,
  routeCards,
  salesOrders,
  vendors,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { emitActivityLog } from '../activity-log/service';
import { assertTreeSound, lockMlBomTree, reresolveOwnLinks } from '../ml-bom/guards';
import type {
  ListTrashQuery,
  ListTrashResponse,
  RestoreTrashInput,
  TrashEntityType,
  TrashListItem,
} from './schema';
import { TRASH_SF_COLUMNS } from './sf-columns';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// Per-entity metadata. `labelSql` returns the human-readable identifier
// (typically the entity's code/number column). `table` is the unquoted
// table name. `hasUpdatedBy` controls whether updated_by is bumped on
// restore.
interface EntityMeta {
  type: TrashEntityType;
  table: string;
  labelSql: string;
  hasUpdatedBy: boolean;
}

// Every entity uses a `code` column for its human identifier (SO-001,
// IN-JC-00001, MACH-A1, …) except bom_masters which uses `bom_no`.
const ENTITIES: readonly EntityMeta[] = [
  { type: 'Sales Order', table: 'sales_orders', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Job Work Order', table: 'job_work_orders', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Job Card', table: 'job_cards', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Item', table: 'items', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Client', table: 'clients', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Vendor', table: 'vendors', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Machine', table: 'machines', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Operator', table: 'operators', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Purchase Request', table: 'purchase_requests', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Purchase Order', table: 'purchase_orders', labelSql: 'code', hasUpdatedBy: true },
  {
    type: 'Goods Receipt Note',
    table: 'goods_receipt_notes',
    labelSql: 'code',
    hasUpdatedBy: true,
  },
  { type: 'Delivery Challan', table: 'delivery_challans', labelSql: 'code', hasUpdatedBy: true },
  { type: 'NC Register', table: 'nc_register', labelSql: 'code', hasUpdatedBy: true },
  { type: 'BOM Master', table: 'bom_masters', labelSql: 'bom_no', hasUpdatedBy: true },
  { type: 'Route Card', table: 'route_cards', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Cost Center', table: 'cost_centers', labelSql: 'code', hasUpdatedBy: true },
  { type: 'QC Process', table: 'qc_processes', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Production Order', table: 'production_orders', labelSql: 'code', hasUpdatedBy: true },
  { type: 'Multi-Level BOM', table: 'ml_boms', labelSql: 'code', hasUpdatedBy: true },
];

// Child rows a delete stamps together with their header (one softDeleteStamp
// for both, so they share the exact deleted_at). Restore brings back only the
// children whose deleted_at equals the header's — a line removed by an
// earlier edit carries a different instant and stays deleted. BOM lines are
// never stamped by a BOM delete, so bom_masters has no entry.
const CHILD_TABLES: Partial<Record<TrashEntityType, { table: string; fk: string }[]>> = {
  'Sales Order': [{ table: 'sales_order_lines', fk: 'sales_order_id' }],
  'Job Work Order': [{ table: 'job_work_order_lines', fk: 'job_work_order_id' }],
  'Job Card': [{ table: 'jc_ops', fk: 'job_card_id' }],
  'Purchase Order': [{ table: 'purchase_order_lines', fk: 'purchase_order_id' }],
  'Goods Receipt Note': [{ table: 'goods_receipt_note_lines', fk: 'goods_receipt_note_id' }],
  'Delivery Challan': [{ table: 'delivery_challan_lines', fk: 'delivery_challan_id' }],
  'Route Card': [{ table: 'route_card_ops', fk: 'route_card_id' }],
};

// Used by restore to look up the Drizzle table object by type.
const TABLE_BY_TYPE = {
  'Sales Order': salesOrders,
  'Job Work Order': jobWorkOrders,
  'Job Card': jobCards,
  Item: items,
  Client: clients,
  Vendor: vendors,
  Machine: machines,
  Operator: operators,
  'Purchase Request': purchaseRequests,
  'Purchase Order': purchaseOrders,
  'Goods Receipt Note': goodsReceiptNotes,
  'Delivery Challan': deliveryChallans,
  'NC Register': ncRegister,
  'BOM Master': bomMasters,
  'Route Card': routeCards,
  'Cost Center': costCenters,
  'QC Process': qcProcesses,
  'Production Order': productionOrders,
  'Multi-Level BOM': mlBoms,
} as const satisfies Record<TrashEntityType, unknown>;

// The document type each Trash type is logged under (ADR-197) — the same
// entity its DELETE row was written with, so RESTORE lands on the same
// History tab. Master types with no ACTIVITY_ENTITIES entry use the
// CamelCase name their own service logs with.
const ACTIVITY_ENTITY_BY_TYPE: Record<TrashEntityType, ActivityEntity | (string & {})> = {
  'Sales Order': 'SalesOrder',
  'Job Work Order': 'JobWorkOrder',
  'Job Card': 'JobCard',
  Item: 'Item',
  Client: 'Client',
  Vendor: 'Vendor',
  Machine: 'Machine',
  Operator: 'Operator',
  'Purchase Request': 'PurchaseRequest',
  'Purchase Order': 'PurchaseOrder',
  'Goods Receipt Note': 'GoodsReceiptNote',
  'Delivery Challan': 'DeliveryChallan',
  'NC Register': 'NonConformance',
  'BOM Master': 'BOM',
  'Route Card': 'RouteCard',
  'Cost Center': 'CostCenter',
  'QC Process': 'QcProcess',
  'Production Order': 'ProductionOrder',
  'Multi-Level BOM': 'MlBom',
};

// Screen words for the activity-log line. The type codes above stay as they
// are (they are the API contract); only the two that break the naming
// standard get a display name here.
function typeLabel(type: TrashEntityType): string {
  if (type === 'Client') return 'Customer';
  if (type === 'Job Work Order') return 'JWSO';
  return type;
}

// The words the Trash screen shows for the type codes that differ from them
// (apps/web/src/modules/trash/routes/list.tsx TYPE_LABEL), so a search for
// "Customer" finds deleted Clients.
const TYPE_SCREEN_WORD: Partial<Record<TrashEntityType, string>> = {
  'Job Work Order': 'Job Work Sales Order',
  Client: 'Customer',
  'Cost Center': 'Cost Centre',
};

/** Escape the ILIKE metacharacters so a typed "%" or "_" is matched literally
 *  (Postgres's default LIKE escape is backslash). Local copy, as in the
 *  activity-log service. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `AND (…)` for the Trash search box, or empty when there is no term. */
function searchWhere(term: string | undefined): SQL {
  if (!term) return sql``;
  const pattern = `%${escapeLikeTerm(term)}%`;
  const needle = term.toLowerCase();
  const typesByWord = ENTITIES.map((e) => e.type).filter((t) =>
    (TYPE_SCREEN_WORD[t] ?? '').toLowerCase().includes(needle),
  );
  const typeWordFrag =
    typesByWord.length > 0
      ? sql` OR t.type IN (${sql.join(
          typesByWord.map((t) => sql`${t}`),
          sql`, `,
        )})`
      : sql``;
  return sql`AND (t.label ILIKE ${pattern}
      OR t.type ILIKE ${pattern}
      OR t.deleted_by_name ILIKE ${pattern}${typeWordFrag})`;
}

function unionSql(companyId: string, typeFilter?: TrashEntityType): string {
  const parts = ENTITIES.filter((e) => !typeFilter || e.type === typeFilter).map(
    (e) =>
      `SELECT t.id::text AS id,
              '${e.type.replace(/'/g, "''")}'::text AS type,
              t.${e.labelSql}::text AS label,
              t.deleted_at AS deleted_at,
              COALESCE(t.deleted_by, t.updated_by) AS deleted_by_id,
              u.full_name AS deleted_by_name
       FROM "${e.table}" t
       LEFT JOIN "users" u ON u.id = COALESCE(t.deleted_by, t.updated_by)
       WHERE t.deleted_at IS NOT NULL
         AND t.company_id = '${companyId}'::uuid`,
  );
  return parts.join(' UNION ALL ');
}

export async function listTrash(
  input: ListTrashQuery,
  user: AuthContext,
): Promise<ListTrashResponse> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const baseSql = sql.raw(unionSql(companyId, input.type));
    // Search + Sort & Filter (ADR-200) — one WHERE for the page and its count.
    const sf = readSf(input.sf);
    const where = sql`WHERE TRUE ${searchWhere(input.search)} ${sfWhere(TRASH_SF_COLUMNS, sf)}`;
    // Ends on (type, id): ids are unique per table, so paging never skips or
    // repeats a row deleted in the same instant as another.
    const orderBy = sfOrderBy(TRASH_SF_COLUMNS, sf, sql`t.deleted_at DESC, t.type, t.id`);

    const rowsResult = await tx.execute(
      sql`SELECT * FROM (${baseSql}) t
         ${where}
         ORDER BY ${orderBy}
         LIMIT ${input.limit} OFFSET ${input.offset}`,
    );

    const totalResult = await tx.execute(
      sql`SELECT COUNT(*)::int AS c FROM (${baseSql}) t ${where}`,
    );

    // The Document Type dropdown's counts: every type (not just the chosen
    // one), under the same search + column filters as the list.
    const byTypeResult = await tx.execute(
      sql`SELECT t.type, COUNT(*)::int AS c FROM (${sql.raw(unionSql(companyId))}) t
         ${where}
         GROUP BY t.type`,
    );

    type Row = {
      id: string;
      type: string;
      label: string | null;
      deleted_at: string | Date;
      deleted_by_id: string | null;
      deleted_by_name: string | null;
    };

    const rowsArray = rowsResult as unknown as Row[];
    const totalArray = totalResult as unknown as { c: number }[];
    const byTypeArray = byTypeResult as unknown as { type: string; c: number }[];

    const items_: TrashListItem[] = rowsArray.map((r) => ({
      id: r.id,
      type: r.type as TrashEntityType,
      label: r.label ?? '(unnamed)',
      deletedAt: new Date(r.deleted_at as string | Date).toISOString(),
      deletedById: r.deleted_by_id,
      deletedByName: r.deleted_by_name,
    }));

    const byType: Record<string, number> = {};
    for (const r of byTypeArray) byType[r.type] = Number(r.c);

    return {
      items: items_,
      total: totalArray[0]?.c ?? 0,
      byType,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function restoreFromTrash(
  input: RestoreTrashInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const entity = ENTITIES.find((e) => e.type === input.type);
    if (!entity) throw new ValidationError('This record type cannot be restored from Trash.');

    // One customer per name (the clients service rule): a deleted customer may
    // not come back while a LIVE customer carries the same name, compared
    // trimmed and case-insensitively — else its SOs / invoices split over two.
    if (entity.type === 'Client') {
      const dup = (await tx.execute(sql`
        SELECT live.code, live.name
        FROM public.clients gone
        JOIN public.clients live
          ON live.company_id = gone.company_id
         AND live.deleted_at IS NULL
         AND live.id <> gone.id
         AND lower(trim(live.name)) = lower(trim(gone.name))
        WHERE gone.id = ${input.id}::uuid
          AND gone.company_id = ${companyId}::uuid
        LIMIT 1
      `)) as unknown as Array<{ code: string; name: string }>;
      if (dup[0]) {
        throw new ConflictError(
          `Cannot restore: a customer named "${dup[0].name}" already exists (${dup[0].code}). ` +
            'Rename or delete that customer first, or keep using it.',
        );
      }
    }

    // ADR-207 — Internal SO No. is unique among LIVE Sales Orders (case-
    // insensitive). A deleted SO may not come back while a live SO now uses
    // its number; refuse with a plain message instead of a raw 23505.
    if (entity.type === 'Sales Order') {
      const taken = (await tx.execute(sql`
        SELECT gone.internal_so_no AS "internalSoNo", live.code
        FROM public.sales_orders gone
        JOIN public.sales_orders live
          ON live.company_id = gone.company_id
         AND live.deleted_at IS NULL
         AND live.id <> gone.id
         AND lower(live.internal_so_no) = lower(gone.internal_so_no)
        WHERE gone.id = ${input.id}::uuid
          AND gone.company_id = ${companyId}::uuid
          AND gone.internal_so_no IS NOT NULL
        LIMIT 1
      `)) as unknown as Array<{ internalSoNo: string; code: string }>;
      if (taken[0]) {
        throw new ConflictError(
          `Cannot restore: Internal SO No. ${taken[0].internalSoNo} is now used by ${taken[0].code}. ` +
            "Change that order's Internal SO No. first.",
        );
      }
    }

    // ADR-225 — a Multi-Level BOM comes back under the tree lock, not as
    // Default (its delete cleared the flag), and only while its IN-MLB number
    // is still free (numbers are never reused, so this is a backstop).
    if (entity.type === 'Multi-Level BOM') {
      await lockMlBomTree(tx, companyId);
      const taken = (await tx.execute(sql`
        SELECT live.code
        FROM public.ml_boms gone
        JOIN public.ml_boms live
          ON live.company_id = gone.company_id
         AND live.deleted_at IS NULL
         AND live.id <> gone.id
         AND live.code = gone.code
        WHERE gone.id = ${input.id}::uuid
          AND gone.company_id = ${companyId}::uuid
        LIMIT 1
      `)) as unknown as Array<{ code: string }>;
      if (taken[0]) {
        throw new ConflictError(
          `Cannot restore: BOM No. ${taken[0].code} has been given to a newer Multi-Level BOM.`,
        );
      }
    }

    // The header's delete instant, read before it is cleared — the key that
    // picks out the child rows deleted with it.
    const stampRows = (await tx.execute(
      sql.raw(
        `SELECT deleted_at::text AS deleted_at FROM "${entity.table}"
         WHERE id = '${input.id}'::uuid
           AND company_id = '${companyId}'::uuid
           AND deleted_at IS NOT NULL`,
      ),
    )) as unknown as { deleted_at: string }[];
    const deletedAtText = stampRows[0]?.deleted_at ?? null;

    const result = await tx.execute(
      sql.raw(
        `UPDATE "${entity.table}"
         SET deleted_at = NULL, deleted_by = NULL${entity.hasUpdatedBy ? `, updated_by = '${user.id}'::uuid, updated_at = now()` : ''}
         WHERE id = '${input.id}'::uuid
           AND company_id = '${companyId}'::uuid
           AND deleted_at IS NOT NULL
         RETURNING id, ${entity.labelSql}::text AS label`,
      ),
    );
    const rows = result as unknown as { id: string; label: string | null }[];
    if (rows.length === 0)
      throw new NotFoundError('This record is no longer in Trash. Refresh the page.');

    if (deletedAtText) {
      for (const child of CHILD_TABLES[entity.type] ?? []) {
        await tx.execute(sql`
          UPDATE ${sql.raw(`"${child.table}"`)}
             SET deleted_at = NULL, deleted_by = NULL,
                 updated_by = ${user.id}::uuid, updated_at = now()
           WHERE ${sql.raw(child.fk)} = ${input.id}::uuid
             AND company_id = ${companyId}::uuid
             AND deleted_at = ${deletedAtText}::timestamptz
        `);
      }
    }

    // ADR-225 — the restored BOM's own lines re-link to each child item's
    // CURRENT live Default (manufacture lines only), exactly as a save does,
    // then its tree is re-checked for loop / depth. Same transaction, under
    // the tree lock taken above.
    if (entity.type === 'Multi-Level BOM') {
      await reresolveOwnLinks(tx, companyId, input.id, user);
      await assertTreeSound(tx, companyId, input.id);
    }

    const code = rows[0]?.label ?? null;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Restore,
        entity: ACTIVITY_ENTITY_BY_TYPE[input.type],
        entityId: input.id,
        refId: code ?? input.id,
        detail: `Restored ${typeLabel(input.type)}${code ? ` ${code}` : ''} from Trash`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}

export { TABLE_BY_TYPE };
