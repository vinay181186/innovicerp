# Approval Configuration
**Module key:** `approval-config` · **Domain:** Dashboards, Reporting & System

## Purpose
Single per-company configuration row governing the approval workflow: whether PO / PR / Invoice approvals are required, the manager amount limit for PO auto-approval, and the explicit list of designated approvers. Admin-only writes; any company member reads (the PO list needs to know who can approve). Mirror of legacy `db.approvalConfig`.

## Pages / Screens
`apps/web/src/modules/approval-config/routes/page.tsx` — config form + approval history panel.

## Database Tables
Owns **`approval_config`** (`schema.ts` ~L4780):
- Cols: `id`, `company_id`, `po_approval boolean (default true)`, `po_manager_limit numeric(14,2) default 100000`, `pr_approval boolean (default true)`, `invoice_approval boolean (default false)`, `po_approvers jsonb [] (user id array)`, standard audit cols, `deleted_at`.
- Index: `approval_config_company_uq` unique on `(company_id) where deleted_at is null` (enforces 1 row per company).
- RLS: `approval_config_company_read` (company read); `approval_config_admin_write` (admin only). `company_id` present.

## API Endpoints
`routes.ts` (all require auth):
- `GET /approval-config` — current config (or `APPROVAL_CONFIG_DEFAULTS` if none) → `getApprovalConfig`.
- `PUT /approval-config` — upsert config (admin only) → `saveApprovalConfig`.
- `GET /approval-config/history` — last 20 approval-related activity-log entries → `getApprovalHistory`.

## Services / Key Functions
- `getApprovalConfig(user)` → `ApprovalConfig`; returns shared defaults when no row exists.
- `saveApprovalConfig(input, user)` → validates that `poApprovers` IDs are real users in the same company (bogus IDs silently dropped), upserts the single row, emits a `CONFIG` activity-log entry. Admin only (`requireAdminRole`).
- `getApprovalHistory(user)` → last 20 activity_log rows with action in `APPROVE`/`REJECT`/`PAYMENT`, joined to users for display.

## Entry Points
Admin → Approval Configuration page (System/Finance). Consumed by the purchase-orders / purchase-requests / invoices approval flows to decide whether approval is required and who may approve.

## Business Logic
- **Singleton per company** — enforced by the partial unique index; service upserts (update-if-exists else insert).
- **Approver validation:** only IDs that resolve to active users in the caller's company are persisted (defensive, same stance as access-control).
- **Manager limit:** POs at/under `po_manager_limit` follow the manager-approval path; above it escalates (consumed by the PO module).
- Every save writes a `CONFIG` audit entry summarizing the toggles + limit + approver count.
- Approval history is derived (read) from `activity_log`, not a table this module owns.

## Dependencies on Other Modules (cross-cutting — gates procurement approvals)
Writes emit into `activity-log` (`emitActivityLog`) and history reads from it. Reads `users` for approver validation. Consumed by purchase-orders / purchase-requests / invoices modules to gate their approval workflows.

## User Roles / Access
Read: any authenticated company member. Write: admin only.

## Reports
None (an approval history list, sourced from activity_log).

## Imports / Exports
None.

## Background Jobs
None.
