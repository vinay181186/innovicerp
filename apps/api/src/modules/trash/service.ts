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
// All operations admin-only. Restore clears `deleted_at`.

import { type SQL, sql } from 'drizzle-orm';
import {
  bomMasters,
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
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import type {
  ListTrashQuery,
  ListTrashResponse,
  RestoreTrashInput,
  TrashEntityType,
  TrashListItem,
} from './schema';

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
];

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
} as const satisfies Record<TrashEntityType, unknown>;

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

/** WHERE clause for the Trash search box, or empty when there is no term. */
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
  return sql`WHERE (t.label ILIKE ${pattern}
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
              t.updated_by AS deleted_by_id,
              u.full_name AS deleted_by_name
       FROM "${e.table}" t
       LEFT JOIN "users" u ON u.id = t.updated_by
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
    const where = searchWhere(input.search);

    const rowsResult = await tx.execute(
      sql`SELECT * FROM (${baseSql}) t
         ${where}
         ORDER BY t.deleted_at DESC
         LIMIT ${input.limit} OFFSET ${input.offset}`,
    );

    const totalResult = await tx.execute(
      sql`SELECT COUNT(*)::int AS c FROM (${baseSql}) t ${where}`,
    );

    const byTypeResult = await tx.execute(
      sql.raw(`SELECT t.type, COUNT(*)::int AS c FROM (${unionSql(companyId)}) t GROUP BY t.type`),
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

    const result = await tx.execute(
      sql.raw(
        `UPDATE "${entity.table}"
         SET deleted_at = NULL${entity.hasUpdatedBy ? `, updated_by = '${user.id}'::uuid, updated_at = now()` : ''}
         WHERE id = '${input.id}'::uuid
           AND company_id = '${companyId}'::uuid
           AND deleted_at IS NOT NULL
         RETURNING id`,
      ),
    );
    const rows = result as unknown as { id: string }[];
    if (rows.length === 0)
      throw new NotFoundError('This record is no longer in Trash. Refresh the page.');

    await emitActivityLog(
      tx,
      {
        action: 'RESTORE',
        entity: input.type,
        detail: `Restored ${typeLabel(input.type)} from Trash`,
        refId: input.id,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}

export { TABLE_BY_TYPE };
