// JC-level computed status from `v_jc_status` view (apps/api/src/db/migrations/
// 0006_phase3_views.sql line 142-150). Mirrors legacy `jcStatus` from
// calcEngine() (legacy line 1718-1728).
//
// `no_ops` is a edge state (JC exists but has zero jc_ops rows) — surfaces
// as a UI warning. `closed` is admin-set via `closed_at`.
export const JC_COMPUTED_STATUSES = ['open', 'qc_pending', 'complete', 'closed', 'no_ops'] as const;
export type JcComputedStatus = (typeof JC_COMPUTED_STATUSES)[number];
