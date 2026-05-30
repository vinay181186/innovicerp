# PARITY — System Settings (full sidebar section)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`, sidebar block L516–524.
> **Goal:** map every legacy `render*` under the System Settings sidebar, identify React gaps, and build 1:1 (per session goal 2026-05-31).

---

## Inventory

| # | Legacy item | Legacy fn (line) | React route | Status after this build |
|---|---|---|---|---|
| 1 | User Management | `renderUsers` L13435 | `/users` | ✅ (added Approver chip column 2026-05-31) |
| 2 | Access Control | `renderAccessControl` L13861 | `/access-control` | ✅ shipped 2026-05-30 |
| 3 | Alerts Dashboard | `renderAlerts` L22323 | `/alerts` | ✅ existing |
| 4 | Alert Configuration | `renderAlertConfig` L22427 | `/alerts/config` | ✅ existing |
| 5 | **Approval Configuration** | `renderApprovalConfig` L21608 | `/approval-config` | **✅ NEW 2026-05-31** |
| 6 | Print Templates | `renderPrintTemplates` L14660 | `/print-templates` | ✅ shipped 2026-05-25 |
| 7 | **Operation Log** | `renderOpLog` L13194 | `/op-log` | **✅ NEW 2026-05-31** (read-only) |
| 8 | **Trash** | `renderTrash` L11309 | `/trash` | **✅ NEW 2026-05-31** |
| 9 | Settings | `renderSettings` L13351 | `/settings` | ✅ extended (OSP + Data Integrity panels added 2026-05-31) |
| 10 | **Backup & Export** | `renderBackup` L21963 | `/backup` | **✅ NEW 2026-05-31** (stats + JSON download; restore/factory-reset deferred) |

Sidebar now mirrors the legacy ⚙ System Settings block (HTML L516) with all 10 items present.

---

## Migrations landed

- `0046_phase8_approval_config.sql` — `approval_config` table (per-company config + `po_approvers` jsonb) + `users.approval_limit` numeric column.
- `0047_phase8_osp_processes.sql` — `osp_processes` table (process name + preferred vendor FK + auto-PO + lead-time), case-insensitive unique per company.

Both applied to dev DB.

---

## Per-item details

### 5. Approval Configuration (NEW, ADR-036)

Mirror of legacy db.approvalConfig (single JSON blob) + per-user `approvalLimit`. Surfaces:

- **PO Approval** — toggle + amount limit + approvers picker + flow diagram (Draft → Approve/Reject → Open).
- **PR Approval** — always ON (read-only chip).
- **Invoice Approval** — toggle.
- **Recent Approval Activity** — last 20 `APPROVE`/`REJECT`/`PAYMENT` rows from `activity_log`.

Data shape:
```ts
{
  poApproval: boolean,
  poManagerLimit: number,    // ₹ — manager can approve up to this
  prApproval: true,          // always true; not editable
  invoiceApproval: boolean,
  poApprovers: string[],     // user IDs; admins implicit
}
```

API: `GET /approval-config`, `PUT /approval-config` (admin), `GET /approval-config/history`.

**Deferred:** the actual draft-then-approve PO flow (`_approvePO`/`_rejectPO`) is a separate slice — this slice only lands the config surface + storage. Today's PO module still creates POs as `'open'` directly; that flips to `'draft'` when the audit pass wires the `_poInitialStatus()` legacy helper into our `createPurchaseOrder`.

### 7. Operation Log (NEW)

Read-only paginated viewer of `op_log` joined with `jc_ops` + `job_cards` + `items` + `machines` + `users`. Filters: JC code, log type (start/complete/qc), shift, date range.

**DELTA from legacy:** no delete action. Legacy `delLog` (L13224) hard-deleted log rows which:
1. Violates CLAUDE.md Rule #8 (no hard deletes from app code).
2. Breaks every downstream qty-done calc that aggregates `op_log` SUMs.

Corrections happen by recording a new offsetting log entry, not by deletion. If `op_log` ever gets a `deleted_at` column for genuine admin override, the delete action can be restored behind admin-only RLS.

### 8. Trash (NEW)

UNION ALL query across 17 soft-deletable entity tables (`sales_orders`, `job_work_orders`, `job_cards`, `items`, `clients`, `vendors`, `machines`, `operators`, `purchase_requests`, `purchase_orders`, `goods_receipt_notes`, `delivery_challans`, `nc_register`, `bom_masters`, `route_cards`, `cost_centers`, `qc_processes`). Per-type counts in the filter dropdown.

Actions:
- **Restore** — clears `deleted_at` on the row (admin only).
- **Permanently Delete** — HARD DELETE (admin only). This is the documented admin path per CLAUDE.md Rule #8 — typed confirmation in the UI, audit log emitted *before* the row vanishes so the trail survives.
- **Empty All** — typed "DELETE" confirmation; hard-deletes everything in trash company-wide.

API: `GET /trash`, `POST /trash/restore`, `POST /trash/perm-delete`, `POST /trash/empty`.

### 9. Settings (extended)

Existing Company info panel kept. Two new panels appended:

- **🏭 OSP Process Configuration** — full CRUD on `osp_processes`. Mirror of legacy Settings block L13399 (with `_addOspProcess`/`_editOspProcess`/`_delOspProcess`). Case-insensitive duplicate guard. Auto-PO toggle disabled when no vendor selected.
- **🔗 Data Integrity Check** — single Run button → `GET /data-integrity`. Returns 8 checks (DI-001…DI-008) covering: orphan JCs, JC Ops without machine, negative stock, stale Draft POs, stale Pending NCs, stale unconverted PRs, overdue JCs, zero-qty SO lines. Each result panel coloured green/amber/red with up to 5 sample identifiers.

**Deferred:** legacy's User Preferences + Multi-User Firebase setup are N/A under Supabase Auth; Data Management (export/import/reset) moved to the new `/backup` page.

### 10. Backup & Export (NEW, simplified)

Three panels:
- **Summary cards** — collection count, total record count, backup-schedule chip pointing at the daily pg_dump → B2 chain.
- **📤 Export** — single "Download JSON Backup" button. Streams a JSON dump of every collection (admin only). Capped at 5,000 rows per table on the on-demand path so big tables don't OOM the browser.
- **📥 Restore / Factory Reset** — informational only. Restore is the runbook path (cut traffic → pg_dump restore → DNS cutover); Factory Reset is not exposed in-app.

API: `GET /backup/stats`, `GET /backup/download` (returns `application/json` with `Content-Disposition: attachment`).

**Deferred from legacy:** Hash-Verified Backup (SHA-256), Verify Backup File, Audit Log Integrity Check, CSV/per-collection export, Import / Restore in-app, Factory Reset Go-Live, Auto-Backup Schedule UI. All real backup discipline is the runbook chain; in-app convenience is the JSON dump only.

---

## Open DELTAs to record at close-out

1. `op_log` delete intentionally not ported (CLAUDE.md Rule #8).
2. Restore-from-trash for an entity with a hard FK from a now-orphan child (e.g. restoring a Job Card whose JC Ops were cascade-deleted) only restores the parent. Downstream rebuild would require recursive trash. Acceptable for now.
3. Approval flow on PO is config-only; actual draft/approve plumbing in `purchase-orders` module is deferred to the audit pass.
4. Per-user `approval_limit` column landed but no UI surface yet — User Edit page should add the field. Deferred.
5. Multi-User Firebase setup is N/A (legacy artifact).

---

## Build summary

Sidebar System Settings section now contains 8 entries (User Mgmt, Access Control, Approval Config, Print Templates, Op Log, Trash, Settings, Backup & Export). All 10 legacy `render*` targets mapped (8 in System Settings + Alerts/AlertConfig kept in their existing Tasks & Alerts location to avoid sidebar churn).

Three new shared schemas (`approval-config`, `osp-process`, `data-integrity`), six new API modules (`approval-config`, `op-log-viewer`, `trash`, `osp-processes`, `data-integrity`, `backup`), six new web modules (`approval-config`, `op-log`, `trash`, `backup`, + Settings extensions: `osp-processes-panel` + `data-integrity-panel`), one schema patch (`users.approval_limit`).

Three packages typecheck + lint clean. Migrations 0046 + 0047 applied to dev DB.
