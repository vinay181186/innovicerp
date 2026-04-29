# SCHEMA.md — Living Database Schema

> MUST mirror `apps/api/src/db/schema.ts` exactly. Update in same commit as schema changes.

## Conventions

Every table has:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid not null references companies(id)`
- `created_at timestamptz not null default now()`
- `created_by uuid not null references users(id)`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null references users(id)`
- `deleted_at timestamptz` (null = active)
- RLS enabled with `company_isolation` policy at minimum

## Modules (planned — table-by-table specs added as built)

| Group | Tables | Replaces (Firestore Collections) |
|---|---|---|
| Master Data | companies, users, clients, vendors, items, machines, operators | companies, users, clients, vendors, items, machines, operators |
| Sales & Production | sales_orders, sales_order_lines, job_work_orders, job_cards, jc_ops, op_log | salesOrders, jobWorkOrders, jobCards, jcOps, opLog, runningOps |
| Procurement | purchase_orders, po_lines, grn, grn_lines, store_transactions | purchaseRequests, purchaseOrders, grn, storeTransactions, storeIssues |
| Quality | qc_inspections, qc_attachments, nc_register, capa_records | qcProcesses, qcAssignments, qcDocUploads, ncRegister, capaRecords |
| Dispatch | dispatch_log (with direction enum), delivery_challans | jwDCOutward, jwDCInward, challans, dispatchLog |
| Design | design_projects, design_tasks, design_issues, design_work_log, design_dcrs, design_dcns | designProjects, designTasks, designIssues, designWorkLog, designTimeLog, designDCRs, designDCNs |
| CRM | leads, communications, crm_reminders | leads, communications, crmReminders |
| Outsource | outsource_jobs, osp_process_config, osp_dc, service_pos | outsourceJobs, ospProcessConfig, ospDC, servicePOs |
| Audit & Config | activity_log, dashboard_config, alert_config, print_templates, print_template_revisions | activityLog, trash, dashboardConfig, alertConfig, printTemplates, printTemplateRevisions, stuckThresholds, reportTypes |

Total target: ~41 tables (replacing 67 Firestore collections).

## RLS Policy Pattern

```sql
alter table <table_name> enable row level security;

create policy company_isolation on <table_name>
  for all using (company_id = current_company_id());
```

Tables with role-restricted writes get additional policies (e.g., admin/manager only for inserts on master data, operator-only for op_log inserts).

## Index Discipline

MUST have indexes:
- Every foreign key column (Postgres does NOT auto-index FKs)
- `(company_id, status) where deleted_at is null` on transaction tables
- Time-range columns used in reports
- Unique business keys (`so_number`, `jc_number`, `po_number`, etc.)

## Helper Functions (created in T-003)

- `current_company_id() returns uuid` — reads `company_id` claim from JWT (`current_setting('request.jwt.claims', true)::jsonb->>'company_id'`)
- `current_user_role() returns text` — reads `role` claim from JWT
- `set_updated_at()` trigger — auto-updates `updated_at` on every UPDATE

## Migration History

| Date | Migration | Notes |
|---|---|---|
| — | — | (first migration `0001_initial_schema` lands in T-005) |
