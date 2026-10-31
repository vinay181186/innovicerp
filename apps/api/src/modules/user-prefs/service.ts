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
  DASHBOARD_LIST_OPEN,
  DEFAULT_DASHBOARD_LIST_OPEN,
  DEFAULT_TABLE_DENSITY,
  type DashboardListOpen,
  TABLE_DENSITIES,
  type SaveTableLayoutInput,
  type SaveUiSettingsInput,
  type TableDensity,
  type TableLayout,
  type TableLayoutColumn,
  type UiSettings,
} from '@innovic/shared';
import { and, asc, eq, inArray, isNull, like, notInArray, type SQL, sql } from 'drizzle-orm';
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
/** ADR-264 home: how check lines open (collapsed / expanded). */
export const DASHBOARD_LIST_OPEN_KEY = 'dashboard_list_open';
/** ADR-264 home: one row per check the user opened / closed by hand,
 *  `dash_open_<checkKey>` = 'open' | 'closed'. */
export const DASH_OPEN_PREFIX = 'dash_open_';

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
  return settingsFromRows(rows);
}

function toListOpen(value: string | null | undefined): DashboardListOpen {
  return (DASHBOARD_LIST_OPEN as readonly string[]).includes(value ?? '')
    ? (value as DashboardListOpen)
    : DEFAULT_DASHBOARD_LIST_OPEN;
}

/** Pure: the user's live setting rows → the full settings (defaults filled). */
export function settingsFromRows(rows: ReadonlyArray<{ key: string; value: string }>): UiSettings {
  const dashboardCheckOpen: Record<string, boolean> = {};
  for (const r of rows) {
    if (r.key.startsWith(DASH_OPEN_PREFIX) && r.key.length > DASH_OPEN_PREFIX.length) {
      dashboardCheckOpen[r.key.slice(DASH_OPEN_PREFIX.length)] = r.value === 'open';
    }
  }
  return {
    tableDensity: toDensity(rows.find((r) => r.key === TABLE_DENSITY_KEY)?.value),
    dashboardListOpen: toListOpen(rows.find((r) => r.key === DASHBOARD_LIST_OPEN_KEY)?.value),
    dashboardCheckOpen,
  };
}

/** Insert or overwrite one of the user's settings (last write wins). */
async function upsertSetting(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  key: string,
  value: string,
): Promise<void> {
  await tx
    .insert(userUiSettings)
    .values({
      companyId,
      userId: user.id,
      settingKey: key,
      settingValue: value,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [userUiSettings.companyId, userUiSettings.userId, userUiSettings.settingKey],
      targetWhere: sql`deleted_at is null`,
      set: {
        settingValue: sql`excluded.setting_value`,
        updatedBy: user.id,
      },
    });
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
  // Partial save (ADR-264): only the fields sent change, in one transaction.
  return withUserContext(user, async (tx) => {
    if (input.tableDensity) {
      await upsertSetting(tx, companyId, user, TABLE_DENSITY_KEY, input.tableDensity);
    }
    if (input.dashboardListOpen) {
      await upsertSetting(tx, companyId, user, DASHBOARD_LIST_OPEN_KEY, input.dashboardListOpen);
      // A new "Lists open as" choice clears every per-check override.
      await tx
        .update(userUiSettings)
        .set({ ...softDeleteStamp(user), updatedBy: user.id })
        .where(
          and(
            eq(userUiSettings.companyId, companyId),
            eq(userUiSettings.userId, user.id),
            isNull(userUiSettings.deletedAt),
            like(userUiSettings.settingKey, String.raw`dash\_open\_%`),
          ),
        );
    }
    // Per-check overrides sent in the SAME request apply after the clear.
    // One row per check key (last one wins).
    const perCheck = new Map((input.dashboardCheckOpen ?? []).map((c) => [c.checkKey, c.open]));
    for (const [checkKey, open] of perCheck) {
      await upsertSetting(
        tx,
        companyId,
        user,
        `${DASH_OPEN_PREFIX}${checkKey}`,
        open ? 'open' : 'closed',
      );
    }
    return loadSettings(tx, companyId, user.id);
  });
}

// ─── Table layouts ─────────────────────────────────────────────────────────

/** Server rules: positions are renumbered 0..n-1 in the order the screen sent
 *  (by position, ties kept in payload order); the new first column is always
 *  pinned and never hidden. Returned in display order. */
export function normaliseColumns(columns: TableLayoutColumn[]): TableLayoutColumn[] {
  return columns
    .map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.position - b.c.position || a.index - b.index)
    .map(({ c }, position) =>
      position === 0 ? { ...c, position, pinned: true, hidden: false } : { ...c, position },
    );
}

/** Row-lock order for every write: column_key ascending, so two saves of the
 *  same table lock rows in the same order and cannot deadlock each other. */
const byColumnKey = (a: { columnKey: string }, b: { columnKey: string }): number =>
  a.columnKey < b.columnKey ? -1 : a.columnKey > b.columnKey ? 1 : 0;

type ColumnRow = Pick<
  typeof userTableColumns.$inferSelect,
  'columnKey' | 'position' | 'pinned' | 'hidden' | 'updatedAt'
>;

/** Rows must arrive already ordered — loadLayout ORDER BYs position, column_key. */
export function rowsToLayout(tableKey: string, rows: ColumnRow[]): TableLayout {
  const latest = rows.reduce<Date | null>(
    (max, r) => (max === null || r.updatedAt > max ? r.updatedAt : max),
    null,
  );
  return {
    tableKey,
    columns: rows.map((r) => ({
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

/** Soft-delete the matching rows, locking them in column_key order first. */
async function retireRows(
  tx: DbTransaction,
  where: SQL | undefined,
  user: AuthContext,
): Promise<void> {
  const rows = await tx
    .select({ id: userTableColumns.id })
    .from(userTableColumns)
    .where(where)
    // collate "C" = byte order, the same order byColumnKey gives the insert.
    .orderBy(sql`${userTableColumns.columnKey} collate "C"`)
    .for('update');
  if (rows.length === 0) return;
  await tx
    .update(userTableColumns)
    .set({ ...softDeleteStamp(user), updatedBy: user.id })
    .where(
      inArray(
        userTableColumns.id,
        rows.map((r) => r.id),
      ),
    );
}

export async function getTableLayout(tableKey: string, user: AuthContext): Promise<TableLayout> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadLayout(tx, companyId, user.id, tableKey));
}

/** Saves and resets of ONE user's ONE table take turns (transaction-scoped
 *  advisory lock), so two overlapping saves can never lock rows in opposite
 *  orders and deadlock. Different users / tables never wait on each other. */
async function lockTable(tx: DbTransaction, companyId: string, userId: string, tableKey: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${userId}:${tableKey}`}, 0))`,
  );
}

export async function saveTableLayout(
  tableKey: string,
  input: SaveTableLayoutInput,
  user: AuthContext,
): Promise<TableLayout> {
  const companyId = requireCompany(user);
  const columns = normaliseColumns(input.columns).sort(byColumnKey);
  const keys = columns.map((c) => c.columnKey);
  return withUserContext(user, async (tx) => {
    await lockTable(tx, companyId, user.id, tableKey);
    // 1. Upsert every column the screen sent, in column_key order (lock order).
    //    Keys are unique — the contract refuses duplicates, so ON CONFLICT never
    //    touches one row twice. updated_at is bumped by the set_updated_at trigger.
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
          updatedBy: user.id,
        },
      });
    // 2. Retire any saved column the screen no longer has (removed / renamed):
    //    lock those rows in column_key order first, then soft-delete them.
    await retireRows(
      tx,
      and(liveRowsOf(companyId, user.id, tableKey), notInArray(userTableColumns.columnKey, keys)),
      user,
    );
    return loadLayout(tx, companyId, user.id, tableKey);
  });
}

/** Reset to default: soft-delete every saved column of this table for this user. */
export async function resetTableLayout(tableKey: string, user: AuthContext): Promise<TableLayout> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    await lockTable(tx, companyId, user.id, tableKey);
    await retireRows(tx, liveRowsOf(companyId, user.id, tableKey), user);
    return loadLayout(tx, companyId, user.id, tableKey);
  });
}
