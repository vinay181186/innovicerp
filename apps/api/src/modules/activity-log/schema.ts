// Re-export shared activity-log schemas (CLAUDE.md §8 — shared is the SoT).
export {
  activityLogEntrySchema,
  listActivityLogQuerySchema,
  listActivityLogResponseSchema,
} from '@innovic/shared';
export type {
  ActivityLogEntry,
  ListActivityLogQuery,
  ListActivityLogResponse,
} from '@innovic/shared';
