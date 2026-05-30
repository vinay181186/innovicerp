// Trash service — admin-only soft-delete recovery + permanent delete.
//
// Mirror of legacy renderTrash (HTML L11309) + restoreFromTrash (L2143) +
// permDeleteTrash (L2176) + emptyTrash (L2185). Legacy stored a `db.trash`
// array of cloned records; we don't need that — every entity carries its
// own `deleted_at` column, so trash is just a UNION ALL of soft-deleted
// rows across a curated set of tables.
//
// All operations admin-only. Restore clears `deleted_at`; permanent delete
// is the documented admin path per CLAUDE.md Rule #8.

import { sql } from 'drizzle-orm';
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
  { type: 'Sales Order',         table: 'sales_orders',         labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Job Work Order',      table: 'job_work_orders',      labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Job Card',            table: 'job_cards',            labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Item',                table: 'items',                labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Client',              table: 'clients',              labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Vendor',              table: 'vendors',              labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Machine',             table: 'machines',             labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Operator',            table: 'operators',            labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Purchase Request',    table: 'purchase_requests',    labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Purchase Order',      table: 'purchase_orders',      labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Goods Receipt Note',  table: 'goods_receipt_notes',  labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Delivery Challan',    table: 'delivery_challans',    labelSql: 'code',     hasUpdatedBy: true },
  { type: 'NC Register',         table: 'nc_register',          labelSql: 'code',     hasUpdatedBy: true },
  { type: 'BOM Master',          table: 'bom_masters',          labelSql: 'bom_no',   hasUpdatedBy: true },
  { type: 'Route Card',          table: 'route_cards',          labelSql: 'code',     hasUpdatedBy: true },
  { type: 'Cost Center',         table: 'cost_centers',         labelSql: 'code',     hasUpdatedBy: true },
  { type: 'QC Process',          table: 'qc_processes',         labelSql: 'code',     hasUpdatedBy: true },
];

// Used by restore/perm-delete to look up the Drizzle table object by type.
const TABLE_BY_TYPE = {
  'Sales Order':         salesOrders,
  'Job Work Order':      jobWorkOrders,
  'Job Card':            jobCards,
  'Item':                items,
  'Client':              clients,
  'Vendor':              vendors,
  'Machine':             machines,
  'Operator':            operators,
  'Purchase Request':    purchaseRequests,
  'Purchase Order':      purchaseOrders,
  'Goods Receipt Note':  goodsReceiptNotes,
  'Delivery Challan':    deliveryChallans,
  'NC Register':         ncRegister,
  'BOM Master':          bomMasters,
  'Route Card':          routeCards,
  'Cost Center':         costCenters,
  'QC Process':          qcProcesses,
} as const satisfies Record<TrashEntityType, unknown>;

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
    const baseSql = unionSql(companyId, input.type);

    const rowsResult = await tx.execute(
      sql.raw(
        `SELECT * FROM (${baseSql}) t
         ORDER BY t.deleted_at DESC
         LIMIT ${input.limit} OFFSET ${input.offset}`,
      ),
    );

    const totalResult = await tx.execute(
      sql.raw(`SELECT COUNT(*)::int AS c FROM (${baseSql}) t`),
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
    if (!entity) throw new ValidationError(`Unknown entity type "${input.type}"`);

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
    if (rows.length === 0) throw new NotFoundError(`${input.type} ${input.id} not found in trash`);

    await emitActivityLog(
      tx,
      {
        action: 'RESTORE',
        entity: input.type,
        detail: `Restored ${input.type} ${input.id}`,
        refId: input.id,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}

export async function permDeleteTrash(
  input: RestoreTrashInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const entity = ENTITIES.find((e) => e.type === input.type);
    if (!entity) throw new ValidationError(`Unknown entity type "${input.type}"`);

    // Audit BEFORE the row vanishes so the trail survives.
    await emitActivityLog(
      tx,
      {
        action: 'PERM DELETE',
        entity: input.type,
        detail: `Permanently deleted ${input.type} ${input.id}`,
        refId: input.id,
      },
      companyId,
      user,
    );

    const result = await tx.execute(
      sql.raw(
        `DELETE FROM "${entity.table}"
         WHERE id = '${input.id}'::uuid
           AND company_id = '${companyId}'::uuid
           AND deleted_at IS NOT NULL
         RETURNING id`,
      ),
    );
    const rows = result as unknown as { id: string }[];
    if (rows.length === 0) throw new NotFoundError(`${input.type} ${input.id} not found in trash`);

    return { ok: true };
  });
}

export async function emptyTrash(user: AuthContext): Promise<{ deleted: number }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    let total = 0;
    for (const entity of ENTITIES) {
      const result = await tx.execute(
        sql.raw(
          `DELETE FROM "${entity.table}"
           WHERE company_id = '${companyId}'::uuid
             AND deleted_at IS NOT NULL
           RETURNING id`,
        ),
      );
      const rows = result as unknown as { id: string }[];
      total += rows.length;
    }
    await emitActivityLog(
      tx,
      {
        action: 'PERM DELETE',
        entity: 'Trash',
        detail: `Emptied trash (${total} items)`,
        refId: null,
      },
      companyId,
      user,
    );
    return { deleted: total };
  });
}

export { TABLE_BY_TYPE };
