// Per-user table preferences (ADR-199, table standard 2026-10-01).
//
// Two facts, both owned by the logged-in user only:
//   - tableDensity: Comfortable / Compact, one choice for EVERY table.
//   - a column layout per table: order, pin, hide — one stored row per column.
//
// The user is never sent by the client; the API takes it from the login.
// Column and table keys are stable code identifiers, never screen labels.

import { z } from 'zod';

export const TABLE_DENSITIES = ['comfortable', 'compact'] as const;
export const tableDensitySchema = z.enum(TABLE_DENSITIES);
export type TableDensity = z.infer<typeof tableDensitySchema>;
export const DEFAULT_TABLE_DENSITY: TableDensity = 'comfortable';

export const uiSettingsSchema = z.object({
  tableDensity: tableDensitySchema,
});
export type UiSettings = z.infer<typeof uiSettingsSchema>;

export const saveUiSettingsInputSchema = z.object({
  tableDensity: tableDensitySchema,
});
export type SaveUiSettingsInput = z.infer<typeof saveUiSettingsInputSchema>;

/** Stable table identity, e.g. `so-master`, `report-so-open-backlog`. */
export const tableKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Invalid table key');
/** Stable column identity inside one table, e.g. `so_code`, `item.code`. */
export const columnKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 'Invalid column key');

export const MAX_TABLE_COLUMNS = 80;

export const tableLayoutColumnSchema = z
  .object({
    columnKey: columnKeySchema,
    /** Left-to-right order, 0 = first column. */
    position: z.number().int().min(0).max(200),
    /** Never dropped when the screen is too narrow. */
    pinned: z.boolean(),
    /** Not shown until the user ticks it again. */
    hidden: z.boolean(),
  })
  .refine((c) => !(c.pinned && c.hidden), {
    message: 'A column cannot be both pinned and hidden',
  });
export type TableLayoutColumn = z.infer<typeof tableLayoutColumnSchema>;

export const saveTableLayoutInputSchema = z.object({
  columns: z
    .array(tableLayoutColumnSchema)
    .min(1)
    .max(MAX_TABLE_COLUMNS)
    .refine((cols) => new Set(cols.map((c) => c.columnKey)).size === cols.length, {
      message: 'Each column may appear only once',
    }),
});
export type SaveTableLayoutInput = z.infer<typeof saveTableLayoutInputSchema>;

/** GET response. `columns` is empty when the user has never saved this table
 *  (the screen then uses its own defaults). */
export const tableLayoutSchema = z.object({
  tableKey: tableKeySchema,
  columns: z.array(tableLayoutColumnSchema),
  updatedAt: z.string().nullable(),
});
export type TableLayout = z.infer<typeof tableLayoutSchema>;
