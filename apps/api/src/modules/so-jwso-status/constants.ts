// SO / JWSO status by day (ADR-325) — the module's named numbers.

/** How often the saved copy of today is rewritten. */
export const SO_STATUS_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

/** First run after the API starts — lets the server settle first. */
export const SO_STATUS_SNAPSHOT_FIRST_RUN_MS = 60 * 1000;

/** Advisory-lock key text: one snapshot run at a time across API instances. */
export const SO_STATUS_SNAPSHOT_LOCK_KEY = 'so_status_snapshot';

/** Env switch: set to 'false' to stop the timer (it never runs under test). */
export const SO_STATUS_SNAPSHOT_ENABLED_ENV = 'SO_STATUS_SNAPSHOT_ENABLED';

/** Rows per INSERT in the snapshot upsert (a statement carries at most 65,535 parameters). */
export const SNAPSHOT_INSERT_CHUNK = 500;
