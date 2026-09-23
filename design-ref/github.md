repo: vinay181186/innovicerp
branch: main
path: apps/web

## Last sync
date: 2026-09-23T09:08:59Z

### Updated in this project
- Tokens ported from apps/web/src/styles/tokens.css (2026-09 theme)
- Class vocabulary condensed from innovic-theme.css
- 39 React primitives incl. pickers, file fields, item badge, related docs, print doc
- UI kit: Login, Dashboard, SO list/detail/new, Live Ops, Task Board, Create PO + print

## Screen map
| Screen | Repo files |
|---|---|
| tokens/*.css | apps/web/src/styles/tokens.css, apps/web/src/index.css, apps/web/index.html |
| tokens/components.css | apps/web/src/styles/innovic-theme.css |
| ui_kits/erp/Shell.jsx | apps/web/src/routes/_authenticated.tsx, components/shared/top-nav.tsx, open-tabs-bar.tsx, breadcrumbs.tsx, nav-sections.ts |
| ui_kits/erp/Dashboard.jsx | apps/web/src/routes/index.tsx, modules/dashboard/components/home-admin.tsx, my-work-panel.tsx, quick-links.tsx |
| ui_kits/erp/SalesOrders.jsx | apps/web/src/modules/sales-orders/routes/list.tsx, components/so-sheet-table.tsx, so-status-badge.tsx |
| ui_kits/erp/SoForm.jsx (Login) | apps/web/src/routes/login.tsx; SO form abbreviated from modules/sales-orders/components/sales-order-form.tsx (not fully read) |
| components/data/StatStrip | apps/web/src/components/shared/stat-strip.tsx |
| ui_kits/erp/Screens2.jsx | modules/op-entry (running-ops-board, machine-card), modules/tasks (task-table, board-filters), shared/related-docs-tabs.tsx, purchase-orders/components/po-form-css.ts, lib/print/doc-print.ts |
| components/forms/* | components/shared/searchable-select.tsx, doc-number-input.tsx, line-item-picker.tsx, qc-report-attach.tsx, modules/items/components/*-field.tsx |
| components/data/* (new) | shared/item-badge.tsx, sortable-th.tsx, related-docs-panel.tsx, so-timeline/timeline-body.tsx, plans/planning-kpi-strip.tsx |
| tokens/po-compact.css, tokens/print.css | purchase-orders/components/po-form-css.ts, lib/print/doc-print.ts |
