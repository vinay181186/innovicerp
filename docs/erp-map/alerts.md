# Alerts
**Module key:** `alerts` · **Domain:** Dashboards, Reporting & System

## Purpose
A registry of 15 hard-coded alert rules (each a `definition` + `run` pair). Evaluates rules against the caller's company, returns counts + drill-down records, lets admin/manager toggle rules per-company, lets users subscribe to email digests, and runs a BullMQ worker every 30 min to dispatch those digests. Mirror of legacy `_runAlerts` (ADR-024; 8 of 23 legacy rules deferred pending source data).

## Pages / Screens
`apps/web/src/modules/alerts/routes/`: `dashboard.tsx` (alert counts board), `drill.tsx` (one alert's records), `config.tsx` (toggle rules + manage subscriptions).

## Database Tables
Owns three tables (`schema.ts`):
- **`alert_config`** (~L2245) — per-company per-rule on/off override. Cols: `id`, `company_id`, `code text`, `active boolean`, audit cols. **No soft-delete** (row IS the override). Unique `alert_config_company_code_uniq (company_id, code)`. RLS: company read; `alert_config_manager_write` (admin/manager).
- **`alert_subscriptions`** (~L2289) — `(user_id, code, channel)` opt-in. Cols: `id`, `company_id`, `user_id` (cascade), `code`, `channel default 'email'`, audit cols. **No soft-delete** — unsubscribe = DELETE. Unique `alert_subs_company_user_code_channel_uniq`; index on `(company_id, code)`. RLS: company read; self-or-manager write.
- **`alert_deliveries`** (~L2332) — append-only dispatch audit. Cols: `company_id`, `user_id` (cascade), `code`, `channel`, `window_start`, `message_id`, `record_count`, `real_send boolean`, `created_at/by`. Unique `alert_deliv_idem_uniq (code, user_id, window_start, channel)` — the worker's idempotency key. RLS: manager read; self insert.

## API Endpoints
`routes.ts` (all require auth):
- `GET /alerts` — evaluate all active alerts, return counts → `runAllAlerts`.
- `GET /alerts/config` — registry merged with per-company overrides → `listAlertConfig`.
- `PUT /alerts/config/:code` — toggle a rule active (admin/manager) → `setAlertActive`.
- `GET /alerts/subscriptions` — caller's subscriptions → `subs.listMySubscriptions`.
- `PUT /alerts/subscriptions/:code` — subscribe/unsubscribe (returns 204 on unsubscribe) → `subs.setMySubscription`.
- `GET /alerts/:code` — run one alert, return count + drill records + columns → `runAlert`.

## Services / Key Functions
- `service.runAllAlerts(user)` → parallel-evaluate active rules; a failing rule logs + reports count=0 (never poisons the board). Sorted by code.
- `service.runAlert(code, user)` → one rule's records + columns.
- `service.listAlertConfig(user)` → each definition merged with override (`active`, `isOverridden`).
- `service.setAlertActive(code, active, user)` → 2-step upsert of override (admin/manager, `requireWriteRole`).
- `subscriptions.listMySubscriptions / setMySubscription` → self-only; subscribe = idempotent INSERT, unsubscribe = DELETE.
- `worker.runDigestTick(at)` → the 30-min digest orchestration (see Background Jobs).
- `registry.ts` — `ALERTS` map; 15 rules AL-001..AL-018 (AL-010/016/017/019-023 deferred): pos-today-approved, prs-pending-stale, items-out-of-stock, so-due-7-days, so-overdue, prs-pending, grn-today, grn-pending-qc, nc-recent, bom-pending, jc-overdue, machines-idle, po-overdue, osp-prs-pending-po, nc-pending-disposition.

## Entry Points
Alerts dashboard/board, drill view, config page. Email digests delivered out-of-band by the worker.

## Business Logic
- **Config precedence:** override row if present, else registry `defaultActive`.
- **Resilience:** one bad rule → logged + count 0, board still renders.
- **Subscriptions:** the row is the subscription; no `active` flag.
- **Worker idempotency:** `window_start` = current time floored to 30-min boundary; a second tick in the same window hits `alert_deliv_idem_uniq` and skips re-sending.

## Dependencies on Other Modules (cross-cutting — observes many)
Rule definitions read across sales, purchase, store, QC, production, design data (same domain tables as reports). Uses `lib/email` (Resend), `lib/queue` (BullMQ), `lib/logger`. No writes to other modules.

## User Roles / Access
Read/run + own subscriptions: any authenticated company member. `setAlertActive`: admin/manager. Delivery audit read: admin/manager (RLS).

## Reports
Alert drill-downs act as live "records" lists; not formal reports.

## Imports / Exports
Email digests (HTML table, first 50 records) via Resend. No file import/export.

## Background Jobs
**BullMQ repeatable job every 30 min** (`worker.ts` + `worker-boot.ts`). Boot gated by env: `REDIS_URL` (required to start at all), `ALERTS_PUSH_ENABLED` (register schedule), `RESEND_API_KEY` (real send; otherwise logged with `stub-` message id). Per tick: floor window → load active subscriptions joined with users + config overrides → group by (company, code) and evaluate each rule once per company → for each subscriber with non-empty records, send digest then insert `alert_deliveries` (idempotent). Empty alerts skipped (no empty digests). `startAlertsWorker` is idempotent; `stopAlertsWorker` for graceful shutdown.
