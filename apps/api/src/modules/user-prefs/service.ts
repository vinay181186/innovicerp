// Per-user table preferences (ADR-199, table standard phase 2; migration 0189).
//
//   - UI settings: one value per key per user. First key: table density,
//     applied to every table. No row = the default (comfortable).
//   - Table layouts: one row per column per table per user (order, pin, hide).
//     No rows = the screen uses its own defaults.
//
// The user is always the logged-in one — never taken from the request. Every
// query filters company_id AND user_id (the API connects as postgres, so RLS
// is not enforced at runtime). Last write wins by design: these are personal
// screen preferences, so there is no edit-conflict check.

import {
  DEFAULT_TABLE_DENSITY,
  TABLE_DENSITIES,
  type SaveTableLayoutInput,
  type SaveUiSettingsInput,
  type TableDensity,
  type TableLayout,
  type TableLayoutColumn,
  type UiSettings,
} from '@innovic/shared';
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { userTableColumns, userUiSettings } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** setting_key for the table density (DB check: ^[a-z_]{1,64}$). */
export const TABLE_DENSITY_KEY = 'table_density';

// ─── UI settings ───────────────────────────────────────────────────────────

/** A stored value the contract no longer knows reads as the default. */
export function toDensity(value: string | null | undefined): TableDensity {
  return (TABLE_DENSITIES as readonly string[]).includes(value ?? '')
    ? (value as TableDensity)
    : DEFAULT_TABLE_DENSITY;
}

async function loadSettings(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<UiSettings> {
  const rows = await tx
    .select({ key: userUiSettings.settingKey, value: userUiSettings.settingValue })
    .from(userUiSettings)
    .where(
      and(
        eq(userUiSettings.companyId, companyId),
        eq(userUiSettings.userId, userId),
        isNull(userUiSettings.deletedAt),
      ),
    );
  const density = rows.find((r) => r.key === TABLE_DENSITY_KEY)?.value;
  return { tableDensity: toDensity(density) };
}

export async function getUiSettings(user: AuthContext): Promise<UiSettings> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadSettings(tx, companyId, user.id));
}

export async function saveUiSettings(
  input: SaveUiSettingsInput,
  user: AuthContext,
): Promise<UiSettings> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    await tx
      .insert(userUiSettings)
      .values({
        companyId,
        userId: user.id,
        settingKey: TABLE_DENSITY_KEY,
        settingValue: input.tableDensity,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [userUiSettings.companyId, userUiSettings.userId, userUiSettings.settingKey],
        targetWhere: sql`deleted_at is null`,
        set: {
          settingValue: sql`excluded.setting_value`,
          updatedAt: new Date(),
          updatedBy: user.id,
        },
      });
    return loadSettings(tx, companyId, user.id);
  });
}

// ─── Table layouts ─────────────────────────────────────────────────────────

/** Server rule: the first column (position 0) is always pinned and never hidden. */
export function normaliseColumns(columns: TableLayoutColumn[]): TableLayoutColumn[] {
  return columns.map((c) =>
    c.position === 0 ? { ...c, pinned: true, hidden: false } : { ...c },
  );
}

type ColumnRow = Pick<
  typeof userTableColumns.$inferSelect,
  'columnKey' | 'position' | 'pinned' | 'hidden' | 'updatedAt'
>;

export function rowsToLayout(tableKey: string, rows: ColumnRow[]): TableLayout {
  const sorted = [...rows].sort(
    (a, b) => a.position - b.position || a.columnKey.localeCompare(b.columnKey),
  );
  const latest = sorted.reduce<Date | null>(
    (max, r) => (max === null || r.updatedAt > max ? r.updatedAt : max),
    null,
  );
  return {
    tableKey,
    columns: sorted.map((r) => ({
      columnKey: r.columnKey,
      position: r.position,
      pinned: r.pinned,
      hidden: r.hidden,
    })),
    updatedAt: latest ? latest.toISOString() : null,
  };
}

const liveRowsOf = (companyId: string, userId: string, tableKey: string) =>
  and(
    eq(userTableColumns.companyId, companyId),
    eq(userTableColumns.userId, userId),
    eq(userTableColumns.tableKey, tableKey),
    isNull(userTableColumns.deletedAt),
  );

async function loadLayout(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  tableKey: string,
): Promise<TableLayout> {
  const rows = await tx
    .select({
      columnKey: userTableColumns.columnKey,
      position: userTableColumns.position,
      pinned: userTableColumns.pinned,
      hidden: userTableColumns.hidden,
      updatedAt: userTableColumns.updatedAt,
    })
    .from(userTableColumns)
    .where(liveRowsOf(companyId, userId, tableKey))
    .orderBy(asc(userTableColumns.position), asc(userTableColumns.columnKey));
  return rowsToLayout(tableKey, rows);
}

export async function getTableLayout(tableKey: string, user: AuthContext): Promise<TableLayout> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadLayout(tx, companyId, user.id, tableKey));
}

export async function saveTableLayout(
  tableKey: string,
  input: SaveTableLayoutInput,
  user: AuthContext,
): Promise<TableLayout> {
  const companyId = requireCompany(user);
  const columns = normaliseColumns(input.columns);
  const keys = columns.map((c) => c.columnKey);
  return withUserContext(user, async (tx) => {
    const now = new Date();
    // 1. Upsert every column the screen sent (keys are unique — the contract
    //    refuses duplicates, so ON CONFLICT never touches one row twice).
    await tx
      .insert(userTableColumns)
      .values(
        columns.map((c) => ({
          companyId,
          userId: user.id,
          tableKey,
          columnKey: c.columnKey,
          position: c.position,
          pinned: c.pinned,
          hidden: c.hidden,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      )
      .onConflictDoUpdate({
        target: [
          userTableColumns.companyId,
          userTableColumns.userId,
          userTableColumns.tableKey,
          userTableColumns.columnKey,
        ],
        targetWhere: sql`deleted_at is null`,
        set: {
          position: sql`excluded.position`,
          pinned: sql`excluded.pinned`,
          hidden: sql`excluded.hidden`,
          updatedAt: now,
          updatedBy: user.id,
        },
      });
    // 2. Retire any saved column the screen no longer has (removed / renamed).
    await tx
      .update(userTableColumns)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(
        and(liveRowsOf(companyId, user.id, tableKey), notInArray(userTableColumns.columnKey, keys)),
      );
    return loadLayout(tx, companyId, user.id, tableKey);
  });
}

/** Reset to default: soft-delete every saved column of this table for this user. */
export async function resetTableLayout(tableKey: string, user: AuthContext): Promise<TableLayout> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    await tx
      .update(userTableColumns)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(liveRowsOf(companyId, user.id, tableKey));
    return loadLayout(tx, companyId, user.id, tableKey);
  });
}
