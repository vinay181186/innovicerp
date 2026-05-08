// Re-export shared alert schemas (CLAUDE.md §8 — shared is the SoT).
export {
  alertColumnSchema,
  alertConfigEntrySchema,
  alertDefinitionSchema,
  alertDeptSchema,
  alertResultSchema,
  alertRowSchema,
  listAlertConfigResponseSchema,
  listAlertsResponseSchema,
  runAlertResponseSchema,
  setAlertActiveInputSchema,
} from '@innovic/shared';
export type {
  AlertColumn,
  AlertConfigEntry,
  AlertDefinition,
  AlertDept,
  AlertResult,
  AlertRow,
  ListAlertConfigResponse,
  ListAlertsResponse,
  RunAlertResponse,
  SetAlertActiveInput,
} from '@innovic/shared';
