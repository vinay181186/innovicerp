// Excel import for the Item / Customer / Vendor masters — the ERPNext Data
// Import behaviour (frappe core/doctype/data_import):
//   - Import Type: 'insert' = Insert New Records, 'update' = Update Existing
//     Records (matched by Code — never creates a duplicate);
//   - a preview first (dryRun: true — the server checks every row and writes
//     nothing), then the real import;
//   - per-row results: good rows go in, a bad row is left out with its reason.
//     One bad email no longer rejects the whole sheet.
//
// Update Existing: a BLANK cell keeps the current value (only filled cells are
// written), so a sheet with just Code + HSN Code fills HSN and touches nothing
// else. Every updated record gets its own History (EDIT, Before → After) row.

import { z } from 'zod';

export const MASTER_IMPORT_MODES = ['insert', 'update'] as const;
export type MasterImportMode = (typeof MASTER_IMPORT_MODES)[number];
export const MASTER_IMPORT_MODE_LABEL: Record<MasterImportMode, string> = {
  insert: 'Insert new',
  update: 'Update existing (by Code)',
};

/** Common request envelope. `rows` are checked ONE BY ONE on the server
 *  (a z.unknown() array, so a bad row cannot fail the whole request). */
export const masterImportOptionsSchema = z.object({
  mode: z.enum(MASTER_IMPORT_MODES).default('insert'),
  /** Preview: check every row, write nothing. */
  dryRun: z.boolean().default(false),
});

export type MasterImportRowAction = 'insert' | 'update' | 'skip';

/** What happened (or, in a preview, would happen) to ONE submitted row. */
export interface MasterImportRowResult {
  /** 1-based position in the submitted array. */
  index: number;
  code: string | null;
  name: string;
  action: MasterImportRowAction;
  /** Why the row was skipped. */
  reason?: string;
  /** Master-rule problems (warn mode) — the row still goes in. */
  warnings?: string[];
  /** Update mode: how many fields actually change. */
  changedFields?: number;
}

export interface MasterImportResult {
  dryRun: boolean;
  mode: MasterImportMode;
  created: number;
  updated: number;
  rows: MasterImportRowResult[];
}
