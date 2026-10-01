// Re-export shared table-preference schemas (CLAUDE.md §8 — shared is the SoT).
export {
  DEFAULT_TABLE_DENSITY,
  saveTableLayoutInputSchema,
  saveUiSettingsInputSchema,
  tableKeySchema,
  tableLayoutSchema,
  uiSettingsSchema,
} from '@innovic/shared';
export type {
  SaveTableLayoutInput,
  SaveUiSettingsInput,
  TableDensity,
  TableLayout,
  TableLayoutColumn,
  UiSettings,
} from '@innovic/shared';
