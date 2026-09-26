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
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
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
  { type: 'Production Order',    table: 'production_orders',    labelSql: 'code',     hasUpdatedBy: true },
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
  'Production Order':    productionOrders,
} as const satisfies Record<TrashEntityType, unknown>;

// ─── ADR-184: never hard-delete a row other documents still point at ─────
//
// Permanent delete used to run a bare DELETE and let the foreign keys decide:
// a Sales Order took its invoices with it (ON DELETE CASCADE, now RESTRICT —
// migration 0146) and silently unlinked its plans (SET NULL). Two guards now:
//
//  1. Named checks per entity, so the admin is told WHICH documents block the
//     delete. Sales Order is the one that matters; others can be added here.
//  2. Every DELETE runs inside a savepoint; any foreign-key refusal (SQLSTATE
//     23503) from an entity without a named check is caught and turned into
//     "blocked" / "skipped" instead of aborting the whole request.

interface DependentCheck {
  /** Plural label used in messages, e.g. "invoices". */
  label: string;
  /** Returns the codes of dependent rows for one trashed row id. */
  query: (id: string, companyId: string) => SQL;
}

const DEPENDENT_CHECKS: Partial<Record<TrashEntityType, readonly DependentCheck[]>> = {
  'Sales Order': [
    // Invoices and dispatches block even when they are themselves in Trash:
    // their FK to the SO is RESTRICT / NO ACTION, so the DELETE would fail.
    {
      label: 'invoices',
      query: (id, companyId) => sql`
        SELECT code FROM public.invoices
        WHERE sales_order_id = ${id}::uuid AND company_id = ${companyId}::uuid`,
    },
    {
      label: 'customer dispatches',
      query: (id, companyId) => sql`
        SELECT code FROM public.customer_dispatches
        WHERE sales_order_id = ${id}::uuid AND company_id = ${companyId}::uuid`,
    },
    // Plans / production orders would silently lose their SO link (SET NULL
    // via the cascading SO lines) — refuse while any is still live.
    {
      label: 'plans',
      query: (id, companyId) => sql`
        SELECT p.code FROM public.plans p
        JOIN public.sales_order_lines l ON l.id = p.so_line_id
        WHERE l.sales_order_id = ${id}::uuid
          AND p.company_id = ${companyId}::uuid
          AND p.deleted_at IS NULL`,
    },
    {
      label: 'production orders',
      query: (id, companyId) => sql`
        SELECT po.code FROM public.production_orders po
        JOIN public.plans p ON p.id = po.plan_id
        JOIN public.sales_order_lines l ON l.id = p.so_line_id
        WHERE l.sales_order_id = ${id}::uuid
          AND po.company_id = ${companyId}::uuid
          AND po.deleted_at IS NULL`,
    },
  ],
};

/** "invoices IN-INV-00001, IN-INV-00002; plans PLN-0013" — or '' when free. */
async function describeDependents(
  tx: DbTransaction,
  type: TrashEntityType,
  id: string,
  companyId: string,
): Promise<string> {
  const checks = DEPENDENT_CHECKS[type] ?? [];
  const parts: string[] = [];
  for (const c of checks) {
    const rows = (await tx.execute(c.query(id, companyId))) as unknown as { code: string }[];
    if (rows.length === 0) continue;
    const codes = [...new Set(rows.map((r) => r.code))];
    const shown = codes.slice(0, 10).join(', ');
    parts.push(`${c.label} ${shown}${codes.length > 10 ? ` and ${codes.length - 10} more` : ''}`);
  }
  return parts.join('; ');
}

/** Postgres foreign_key_violation (SQLSTATE 23503). */
function isForeignKeyViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === '23503'
  );
}

/**
 * DELETE one trashed row inside a savepoint. 'blocked' when a foreign key
 * refused it — the savepoint is rolled back and the outer transaction stays
 * usable, so Empty Trash can carry on with the next row.
 */
async function deleteRowGuarded(
  tx: DbTransaction,
  entity: EntityMeta,
  id: string,
  companyId: string,
): Promise<'deleted' | 'missing' | 'blocked'> {
  try {
    const rows = await tx.transaction(async (sp) => {
      const r = await sp.execute(
        sql`DELETE FROM ${sql.identifier(entity.table)}
            WHERE id = ${id}::uuid
              AND company_id = ${companyId}::uuid
              AND deleted_at IS NOT NULL
            RETURNING id`,
      );
      return r as unknown as { id: string }[];
    });
    return rows.length > 0 ? 'deleted' : 'missing';
  } catch (e) {
    if (isForeignKeyViolation(e)) return 'blocked';
    throw e;
  }
}

// Screen words for the activity-log line. The type codes above stay as they
// are (they are the API contract); only the two that break the naming
// standard get a display name here.
function typeLabel(type: TrashEntityType): string {
  if (type === 'Client') return 'Customer';
  if (type === 'Job Work Order') return 'JWSO';
  return type;
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

export async function permDeleteTrash(
  input: RestoreTrashInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const entity = ENTITIES.find((e) => e.type === input.type);
    if (!entity) throw new ValidationError('This record type cannot be restored from Trash.');

    // ADR-184 — refuse while other documents still point at this row.
    const dependents = await describeDependents(tx, input.type, input.id, companyId);
    if (dependents) {
      throw new ConflictError(
        `${input.type} cannot be permanently deleted — it is still used by ${dependents}. ` +
          `Restore it, or remove those documents first.`,
      );
    }

    // Audit BEFORE the row vanishes so the trail survives.
    await emitActivityLog(
      tx,
      {
        action: 'PERM DELETE',
        entity: input.type,
        detail: `Permanently deleted ${typeLabel(input.type)} from Trash`,
        refId: input.id,
      },
      companyId,
      user,
    );

    const outcome = await deleteRowGuarded(tx, entity, input.id, companyId);
    if (outcome === 'missing') {
      throw new NotFoundError('This record is no longer in Trash. Refresh the page.');
    }
    if (outcome === 'blocked') {
      throw new ConflictError(
        `${input.type} cannot be permanently deleted — other records still point at it. ` +
          `Restore it instead.`,
      );
    }

    return { ok: true };
  });
}

/** ADR-184 review — the set-based twin of DEPENDENT_CHECKS['Sales Order']:
 *  a trashed SO is deleted only when nothing in those four lists points at it.
 *  Same four dependents, written as NOT EXISTS so Empty Trash stays one DELETE
 *  per table (CLAUDE.md §6 rule 6 — no per-row queries). */
function salesOrderFreeSql(companyId: string): SQL {
  return sql`
    AND NOT EXISTS (SELECT 1 FROM public.invoices i
                    WHERE i.sales_order_id = t.id AND i.company_id = ${companyId}::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.customer_dispatches d
                    WHERE d.sales_order_id = t.id AND d.company_id = ${companyId}::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.plans p
                    JOIN public.sales_order_lines l ON l.id = p.so_line_id
                    WHERE l.sales_order_id = t.id AND p.company_id = ${companyId}::uuid
                      AND p.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.production_orders po
                    JOIN public.plans p ON p.id = po.plan_id
                    JOIN public.sales_order_lines l ON l.id = p.so_line_id
                    WHERE l.sales_order_id = t.id AND po.company_id = ${companyId}::uuid
                      AND po.deleted_at IS NULL)`;
}

export async function emptyTrash(user: AuthContext): Promise<{ deleted: number; skipped: number }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    let total = 0;
    // ADR-184 — one set-based DELETE per table per pass. A table whose DELETE
    // a foreign key refuses (a trashed child still pointing at a trashed
    // parent listed later) is skipped for that pass inside a savepoint; the
    // next pass retries it once the other side is gone. Passes stop when one
    // deletes nothing. Rows still left are the ones other documents use: they
    // stay in Trash and are counted, never cascaded away.
    for (let pass = 0; pass < ENTITIES.length; pass++) {
      let deletedThisPass = 0;
      for (const entity of ENTITIES) {
        const extra = entity.type === 'Sales Order' ? salesOrderFreeSql(companyId) : sql``;
        try {
          const rows = await tx.transaction(async (sp) => {
            const r = await sp.execute(
              sql`DELETE FROM ${sql.identifier(entity.table)} AS t
                  WHERE t.company_id = ${companyId}::uuid
                    AND t.deleted_at IS NOT NULL ${extra}
                  RETURNING t.id`,
            );
            return r as unknown as { id: string }[];
          });
          deletedThisPass += rows.length;
        } catch (e) {
          if (!isForeignKeyViolation(e)) throw e;
        }
      }
      total += deletedThisPass;
      if (deletedThisPass === 0) break;
    }
    const left = (await tx.execute(
      sql.raw(`SELECT COUNT(*)::int AS n FROM (${unionSql(companyId)}) u`),
    )) as unknown as Array<{ n: number }>;
    const skipped = Number(left[0]?.n ?? 0);
    await emitActivityLog(
      tx,
      {
        action: 'PERM DELETE',
        entity: 'Trash',
        detail:
          skipped > 0
            ? `Emptied trash (${total} items; ${skipped} kept — still used by other documents)`
            : `Emptied trash (${total} items)`,
        refId: null,
      },
      companyId,
      user,
    );
    return { deleted: total, skipped };
  });
}

export { TABLE_BY_TYPE };
