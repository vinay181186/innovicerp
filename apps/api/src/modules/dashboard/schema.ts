// Re-export shared dashboard schemas (CLAUDE.md §8 — shared is the SoT).
export { dashboardKpisResponseSchema, dashboardTileSchema } from '@innovic/shared';
export type {
  DashboardKpisResponse,
  DashboardTile,
  DashboardTileKind,
  DashboardTileSeverity,
} from '@innovic/shared';
