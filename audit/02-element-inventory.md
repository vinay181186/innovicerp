# 02 — Element Inventory: design-ref vs. real app

Scope: every component under `design-ref/components/{core,forms,data,feedback,navigation,layout,print}/`
mapped against its current implementation(s) in `apps/web/src/`. Read-only research; no app files were
changed to produce this report. All paths below were opened and verified, not trusted from the
`design-ref/README.md` "Source mapping" paragraph blindly (several of its claims turned out incomplete —
noted inline).

Legend for the Action column:
- **REBUILD** — a real current equivalent exists; needs reskin/restructure to the design-ref API/shape
- **NEW** — no current equivalent exists at all (or the only "equivalent" is dead code)
- **CONSOLIDATE** — N inline/duplicated implementations exist and should collapse into this one component
- **DELETE** — a deprecated-alias / app-only pattern that folds into another row, not a standalone build

---

## A. Inventory table

### core/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **Badge** | `tone: green\|amber\|blue\|red\|grey\|cyan\|orange\|teal\|purple`, `children`, `style` | No shared `Badge.tsx`. CSS `.badge`/`.b-*` classes exist in `apps/web/src/styles/innovic-theme.css`, consumed only via 9 per-module `*-status-badge.tsx` files (see §B) plus ad-hoc `<span className="badge...">` | **38 files** with inline `className="badge` spans, e.g. `modules/access-control/routes/list.tsx`, `modules/alerts/routes/config.tsx`, `modules/approvals/routes/page.tsx`, `modules/assembly/routes/detail.tsx`, `modules/customer-dispatches/components/dispatch-card.tsx`, `modules/dashboard/components/my-work-panel.tsx` | CONSOLIDATE |
| **Button** | `variant: primary\|success\|danger\|ghost`, `size: md\|sm`, `icon`, `iconOnly`, `pill`, `disabled` | `apps/web/src/components/ui/button.tsx` (shadcn) exists but is barely used. Real usage is raw `<button className="btn btn-primary">` against `.btn`/`.btn-*` CSS already in `innovic-theme.css` | `<button` tag: **201 files**; `className="btn `: **229 files** (e.g. `access-control/components/configure-modal.tsx`, `access-control/routes/list.tsx`, `activity-log/routes/list.tsx`, `alerts/routes/dashboard.tsx`, `approval-config/routes/page.tsx`) | CONSOLIDATE (retire `components/ui/button.tsx`, it's a different token system) |
| **Icon** | `name` (22 fixed lucide names), `size`, `color`, `strokeWidth`, `title` — inlined, no runtime icon-library dependency | None — every module imports `lucide-react` directly | `from 'lucide-react'`: **234 files** (224 under `modules/`) | NEW (thin wrapper; needn't literally inline SVG paths) |
| **StatusBadge** (+PriorityText) | `kind: so\|jc\|jcop\|pr\|po\|prodorder\|grnqc\|dc\|nc\|ncdisp\|txn\|task\|run\|active\|rating\|doc`, `status`, `label` | 9 confirmed `*-status-badge.tsx` files + `store-transactions/components/txn-type-badge.tsx` — see full breakdown in **§B** | 10 files each re-implementing its own status→tone map | CONSOLIDATE — see §B for exact conflicts |
| **SyncDot** | `state: ok\|offline\|error`, `label` | `apps/web/src/components/shared/top-nav.tsx` line 194 — raw `<span className="sync-dot" />`, no state prop, no label | 1 file | REBUILD (extract into a real component, wire states) |
| **Tag** | `tone: link\|neutral\|rev`, `color`, `bg`, `onClick`, `children` — replaces `.task-linked-ref` | No shared component. `.tag` CSS class + inline `style={{background,color}}` already used | ~9 files: `job-cards/components/jc-op-card.tsx` (×4), `access-control/components/configure-modal.tsx`, `job-cards/components/jc-op-edit-card.tsx`, `op-log/routes/list.tsx`, `party-materials/routes/list.tsx`, `route-cards/routes/detail.tsx`, `so-planning/routes/workflow.tsx`, `store-inventory/routes/list.tsx`, `tasks/components/related-ref-link.tsx` | CONSOLIDATE |

### forms/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **CheckField** | `type: checkbox\|radio`, `label`, `checked`, `onChange`, `name`, `disabled` | None — raw `<input type="checkbox">`/`type="radio"` everywhere, no `.check-row` class | `type="checkbox"`: **15 files** (`access-control/components/configure-modal.tsx`, `alerts/routes/config.tsx`, `alerts/routes/dashboard.tsx`, `approval-config/routes/page.tsx`, `dashboard/components/home-customize.tsx`, `job-cards/components/jc-op-edit-card.tsx`, `job-cards/components/jc-status-view.tsx`, `jw-dc/routes/list.tsx`) | NEW (README confirms this is intentional — "the app uses raw inputs") |
| **DocNumberInput** | `label`, `required`, `value`, `onChange`, `state: idle\|checking\|ok\|bad`, `message`, `readOnly`, `poType`, `size` | `apps/web/src/components/shared/doc-number-input.tsx` — real, active, wired to `useDocNumber` hook; see full behavior spec in **§D.2** | N/A | REBUILD — restructure to `state` enum + `form-grp f-{size}` shape, preserve all §D.2 behavior |
| **FileField** | `variant: attach\|drawing\|image`, `label`, `fileName`, `busy`, `error`, `help`, `accept`, `onPick`, `onRemove`, `onView` | 3 real files: `components/shared/qc-report-attach.tsx` (attach), `modules/items/components/drawing-upload-field.tsx` (drawing), `modules/items/components/item-image-field.tsx` (image) | N/A — 3 files to merge | CONSOLIDATE (3 files → 1 with `variant` prop) |
| **FormField** | `label`, `required`, `help`, `error`, `size: xs\|sm\|md\|lg\|full` | No component. `.form-grp`/`.form-label` CSS exists; every field hand-assembled in JSX | `form-grp`/`form-label` raw: **96 files** | NEW (CSS foundation exists, zero React wrapper) |
| **FormGrid** *(inside FormField.jsx)* | `cols?: 2\|3\|4` (legacy), else `.form-grid-12` | No component; `.form-grid-12` **does not exist yet** in app CSS (only `.form-grid`/`form-row` found) | Same 96 files | NEW (genuinely new CSS infra, not just a missing wrapper) |
| **Input** | Thin wrapper: `className="innovic-input" {...rest}` | No shared wrapper. `components/ui/input.tsx` (shadcn) exists, unused for this pattern. Real usage: raw `<input className="innovic-input">` | `innovic-input` class raw: **134 files**; raw `<input>` total: **147 files** | CONSOLIDATE |
| **LineItemPicker** | `code`, `itemId`, `itemName`, items lookup, `readOnly`, `nameError`, `onChange` | `apps/web/src/components/shared/line-item-picker.tsx` — real, uses `useItemsList` (TanStack dedup); see full behavior spec in **§D.3** | N/A | REBUILD — keep live-hook architecture, restyle only |
| **SearchInput** | `value`, `onChange`, `placeholder`, `width`, `size`, `style` — "the ONE search box" | `apps/web/src/components/shared/global-search.tsx` already implements the target markup (`gs-wrap`/`gs-icon`) but only for header/Ctrl-K search, not extracted as reusable | **22 files** use bare `placeholder="Search..."` instead: `activity-log/routes/list.tsx`, `bom-master/components/bom-form.tsx`, `bom-master/routes/list.tsx`, `clients/routes/list.tsx`, `cost-centers/routes/list.tsx`, `customer-dispatches/routes/list.tsx`, `goods-receipt-notes/routes/list.tsx`, `items/routes/list.tsx` | CONSOLIDATE (extract `gs-wrap` markup, swap the 22 onto it) |
| **SearchableSelect** | `value`, `onChange`, `options`, `placeholder`, `disabled`, `loading`, `emptyText` | `apps/web/src/components/shared/searchable-select.tsx` (394 lines) — real, heavily used, server-search architecture; see full behavior spec in **§D.1** | N/A | REBUILD — visual reskin only, keep server-search (`onSearch`) architecture, it's correct for real data volumes |
| **Select** | Thin wrapper: `<select className="innovic-select">`, `options` | No wrapper. `components/ui/select.tsx` (shadcn/Radix) exists, unused. Real usage raw `<select className="innovic-select">` | `innovic-select` class raw: **85 files**; raw `<select>` total: **95 files** | CONSOLIDATE |
| **Textarea** | Thin wrapper: `<textarea rows={3} className="innovic-textarea">` | No wrapper. `components/ui/textarea.tsx` (shadcn) unused. Raw `<textarea>`: 30 files, only 19 use `innovic-textarea` | Raw `<textarea>`: **30 files**; 11 of those **don't** use `innovic-textarea` (styling drift) — e.g. `access-control/components/configure-modal.tsx`, `bom-master/components/bom-form.tsx`, `capa/components/capa-view.tsx`, `delivery-challans/routes/create.tsx`, `design-projects/routes/{detail,list}.tsx` | CONSOLIDATE (also fixes the 11-file styling drift) |

**`apps/web/src/components/ui/` dead-code finding (core+forms agent):** a stale shadcn scaffold, not the app's real token system. Only 7 files import from it at all: `components/shared/error-boundary.tsx` (Button), `components/shared/searchable-select.tsx` (Input — internal dependency, note when retiring), `modules/saved-reports/{components/result-table.tsx,routes/list.tsx,routes/run.tsx}` (Button, Card*, table), `routes/login.tsx` and `routes/reset-password.tsx` (Button, Input). `ui/select.tsx`, `ui/textarea.tsx`, `ui/label.tsx` have **zero** importers. Small, isolated blast radius — migrate these 7 files onto the new primitive library, then delete `components/ui/`.

### data/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **DataTable** | `columns[]`, `rows`, `frozen`, `density`, `editable`, `autoWidth`, `onRowClick`, `rowClassName`, `maxHeight`, `emptyText`, `hint` | No component. Raw `<table className="innovic-table">` per screen. `components/ui/table.tsx` (shadcn, unused except `saved-reports/components/result-table.tsx`) | **123 files** with `className="innovic-table..."` (27 also hand-roll `position:sticky` for frozen-column). E.g. `items/routes/list.tsx`, `job-cards/routes/list.tsx`, `purchase-orders/routes/list.tsx`, `goods-receipt-notes/routes/list.tsx`, `sales-orders/routes/list.tsx`, `nc-register/routes/list.tsx` | CONSOLIDATE (biggest single migration; retire `ui/table.tsx`) |
| **EmptyState** | `icon`, `tone: muted\|ok\|error`, `children` | No component. Inline `<div className="empty-state">`, CSS class only | **194 files** with `className="empty-state"` | CONSOLIDATE |
| **ItemBadge** | `code`, `revision`, `name`, `src`, `size: row\|card\|page\|tile`, `showName`, `showImage`, `codeColor`, `onOpenImage` | `apps/web/src/components/shared/item-badge.tsx` — real, canonical, well-adopted; prop names differ (`imagePath` not `src`, `onClick` not `onOpenImage`); full behavior in **§D.5** | 0 | REBUILD — align prop names only, preserve all §D.5 behavior |
| **ItemImageBox** | `src`, `size`, `fill`, `onOpen` | Same file, `ItemImageBox()` export (also exports `ItemThumbnailHeader`/`ItemThumbnailCell`, not in design-ref) | 0 | REBUILD (same file) |
| **KpiTiles** | `@deprecated` alias of StatStrip | `modules/plans/components/planning-kpi-strip.tsx` — a DIFFERENT, not-migrated tile grid (3px top-color-border cards), not built on StatStrip | 1 file | DELETE — fold into StatStrip usage |
| **MachineCard** | `code`, `name`, `running`, `jobCard`, `itemCode`, `operation`, `selected`, `onSelect` | `apps/web/src/modules/op-entry/components/machine-card.tsx` — real but props differ (`machine`/`running` objects, `isSelected`) | 4 other files with own machine-tile markup: `machine-loading/routes/list.tsx`, `op-entry/components/op-entry-form.tsx`, `op-entry/components/op-entry-modal.tsx`, `daily-report/routes/list.tsx` — plus `machine-loading/routes/list.tsx`'s `.mach-card` is explicitly commented in-code as "not ported to theme" | REBUILD + CONSOLIDATE 4 files. Also needs a **planned-vs-actual sub-row / `⚙N` chip slot** to absorb `machine-split.tsx` (see §C) |
| **Panel** | `title`, `actions`, `bodyPadding`, `children` | No component. `.panel`/`panel-hdr`/`panel-title`/`panel-body` CSS only. `components/ui/card.tsx` (shadcn Card) exists, used only by 3 saved-reports files, different visual system | **180 files** with `className="panel"` | CONSOLIDATE (also retire `ui/card.tsx`, migrate its 3 consumers) |
| **ProgressBar** | `value (0-100)`, `color`, `height` | No component, no CSS class for it | **16 files** hand-roll outer/inner div bars: `assembly/routes/detail.tsx`, `dashboard/components/home-widgets.tsx`, `design-projects/routes/list.tsx`, `job-cards/components/jc-stat-tiles.tsx`, `job-cards/routes/list.tsx` (×2), `machine-loading/routes/list.tsx`, `production-dashboard/routes/index.tsx`, `production-orders/routes/detail.tsx`, `qc-call-register/components/qc-sheet.tsx`, `qc-command/components/ParetoTab.tsx`, `qc-documents/routes/list.tsx`, `so-overview/routes/list.tsx`, `so-planning/routes/workflow.tsx`, `so-qc-status/components/so-qc-status-view.tsx`, `so-status/components/so-status-detail.tsx`, `so-status/routes/index.tsx` | NEW + CONSOLIDATE |
| **QtyStrip** | `items[]{label,value,color}` — bordered metric group | No component. Each doc-card defines its own local helper | **14 files** define a local `QtyBox`/`StatFact`/`MetricBox`: `customer-dispatches/components/dispatch-card.tsx`, `delivery-challans/components/dc-card.tsx`, `goods-receipt-notes/routes/list.tsx`, `job-cards/routes/list.tsx`, `job-work-orders/routes/list.tsx`, `op-entry/components/op-entry-modal.tsx`, `party-grn/components/party-grn-card.tsx`, `production-orders/routes/{detail,new}.tsx`, `purchase-orders/routes/list.tsx`, `purchase-requests/{components/pr-card.tsx,routes/detail.tsx}`, `sales-orders/routes/list.tsx`, `tasks/components/task-detail-body.tsx` | NEW + CONSOLIDATE |
| **Fact** | `@deprecated` alias of ReadField (layout/) | ReadField itself doesn't exist yet either — same 14 QtyStrip files double as the closest predecessor | Same 14 files | NEW (depends on ReadField, out of data/ scope) |
| **RelatedDocs** | `sections[]{key,title,icon,items[]}`, `activeKey`, `onSelect`, embeds Timeline(compact) | TWO competing files: `components/shared/related-docs-tabs.tsx` (`RelatedDocsTabs`, tab-per-bucket) and `components/shared/related-docs-panel.tsx` (`RelatedDocsPanel`, `variant='full'\|'compact'`, section-block, not tabbed). Both fetch the same `['related-docs', module, id]` query independently; `RelatedDocsTabs` imports `StatusBadge`/`Timeline`/`renderCode` FROM `related-docs-panel.tsx` | 0 extra — but 2 competing canonical files | REBUILD + CONSOLIDATE (merge tab UI + section UI into one) |
| **SortHeader** | `label`, `active`, `dir: asc\|desc`, `onSort` | `components/shared/sortable-th.tsx` (`SortTh`/`nextSort`) is **dead code — zero importers anywhere**. `components/shared/sortable-head.tsx` (`SortableHead`, TanStack-table based) is the only one in real use | `SortableHead` imported by only **2 files**: `production-orders/routes/list.tsx`, `so-planning/routes/workflow.tsx`. The other ~120 list tables use plain unsorted `<th>` (see §D.6 for full server-sort vs client-sort distinction — SortTh's `nextSort()` pattern is still the right model for the ~120 server-paginated lists even though the file itself is unused today) | REBUILD (keep SortableHead's TanStack approach for client tables) + DELETE `sortable-th.tsx` unless revived for server-sort lists — see §D.6 caveat |
| **StatCard** | `@deprecated` — one-cell StatStrip | Two separate **module-private** `function StatCard(...)`, not shared, different signatures: `production-schedule/routes/list.tsx` line 531, `so-documents/components/so-documents-section.tsx` line 214 | 2 files, not even exported | DELETE — fold both into StatStrip |
| **StatStrip** | `items[]{key,label,count,color,sub,active,onClick}` | `apps/web/src/components/shared/stat-strip.tsx` — near 1:1 match already; real version adds a `to` prop (renders `<Link>` for dashboard KPIs); full behavior in **§D.7** | 0 | REBUILD — add `to` prop to design-ref API (or route it through `onClick` + `navigate`, but §D.7 explicitly forbids that for the Link case) |
| **Timeline** | `events[]{date,label,detail,color,icon,code}`, `density: regular\|compact` | TWO files: `modules/so-timeline/components/timeline-body.tsx` (`SoTimelineBody`, the "rail" variant, SO-specific header) and `related-docs-panel.tsx`'s exported `Timeline()` (compact, one-line-per-event, shared by both RelatedDocs files) | 0 extra, but split with no shared `density` switch | REBUILD + CONSOLIDATE (merge rail + compact, `density` prop) |

### feedback/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **Banner** | `tone: warn\|ok\|error\|info`, `title`, `children`, `accent`, `onDismiss` | `modules/job-cards/components/jc-recovery-banner.tsx` (`RecoveryBanner` — hardcoded amber/warn only, JC-specific copy, no `tone` prop) + `routes/login.tsx` (inline, lines ~104-119, Tailwind-style, `role="status"`, a completely different CSS system) | **23 files** with ad-hoc `role="alert"` divs reusing `panel`/`panel-body` as an improvised banner — e.g. `qc-processes/routes/list.tsx`, `tpi-masters/routes/list.tsx` (both have code comments literally justifying "why a banner and not a toast"), `capa/components/capa-view.tsx`, `job-cards/components/job-card-form.tsx`, `op-entry/components/op-entry-form.tsx`, `plans/components/plan-form.tsx`, `production-orders/components/po-close-form.tsx` | NEW + CONSOLIDATE (2 named files + ~23 sites) |
| **ConfirmDialog** | `title`, `message`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel`, `tone: danger\|primary`, `inline` | `apps/web/src/lib/exit-guard.tsx` exports `ExitConfirmDialog` but it is **fully hardcoded** (fixed "exit" copy, no props) — cannot be reused generically. **No parametrized ConfirmDialog exists anywhere** (`find -iname "*confirm-dialog*"` → 0 hits) | **13 files** use raw `window.confirm(...)`: `bom-master/routes/detail.tsx`, `design-projects/routes/detail.tsx`, `design-tracker/routes/list.tsx`, `design-work-log/routes/list.tsx`, `party-materials/routes/list.tsx`, `print-templates/routes/editor.tsx`, `purchase-requests/routes/list.tsx`, `qc-documents/routes/list.tsx`, `report-types/components/report-types-panel.tsx`, `route-cards/routes/detail.tsx` (+3 more) plus **17 files** with an inline "Delete? [Confirm][Cancel]" button-swap (useState toggle, no modal): `clients/routes/detail.tsx`, `cost-centers/routes/detail.tsx`, `goods-receipt-notes/routes/detail.tsx`, `items/routes/detail.tsx`, `job-cards/components/jc-row-write-actions.tsx`, `job-work-orders/routes/detail.tsx`, `machines/routes/detail.tsx`, `nc-register/routes/detail.tsx`, `operators/routes/detail.tsx`, `plans/routes/detail.tsx` (+7 more) | NEW + CONSOLIDATE (~30 files: 13 `window.confirm` + 17 inline swap). Per design-ref's own prompt.md: RowActions must fire `onDelete` only, never own the confirm — the caller opens ConfirmDialog |
| **FilePreview** | `fileName`, `kind: pdf\|image\|none`, `src`, `canDownload`, `onDownload`, `onClose`, `inline` | `apps/web/src/components/shared/file-preview-modal.tsx` (`FilePreviewModal`) — real, canonical, well-adopted. Semantics differ: real `kind` means `'file'\|'drawing'` (access-control classification) vs design-ref's `kind` meaning the rendered preview TYPE; `canDownload` is derived internally via `useMyAccess()`; takes `storagePath` not `src`, self-fetches signed URLs | 0 | REBUILD — reconcile the two different meanings of `kind`, expose `canDownload`/`onDownload` as pass-through props |
| **Modal** | `open`, `title`, `onClose`, `footer`, `size: sm\|md\|lg`, `inline` | No shared component. `.modal`/`.overlay`/`.modal-hdr`/`.modal-footer` CSS exists, reused by `exit-guard.tsx` and `file-preview-modal.tsx`, but no generic `<Modal>` wrapper for ordinary forms | **7 files** hand-roll `className="overlay"` + modal markup (9 total use `modal-hdr`): `bom-master/routes/detail.tsx`, `daily-task-reports/components/report-modals.tsx`, `design-projects/routes/list.tsx`, `jw-dc/routes/list.tsx`, `store-issues/routes/list.tsx`, `tasks/components/task-overlay.tsx`, `tool-issues/components/tool-issue-register-view.tsx` | NEW + CONSOLIDATE (7 files) |
| **Toast** | `kind: ok\|err\|info`, `children` | **No React usage anywhere.** Only dead CSS survives (`#toast`, `.toast-item`, `.toast-ok/.err/.info`, `@keyframes toastSlideIn` in `innovic-theme.css`; `--shadow-toast` token). No `toast()`/`useToast()` helper, no `sonner`/`react-hot-toast` in `package.json`. Save/error feedback today goes through inline banners instead (see Banner's 23 sites, whose comments explicitly say "why a banner and not a toast") | 0 (nothing to consolidate) | NEW |
| **ToastStack** | `children` | Same dead `#toast` CSS container, no consumer | 0 | NEW |

### navigation/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **Breadcrumbs** | `crumbs: {label,link?}[]`, `onNavigate?` | `apps/web/src/components/shared/breadcrumbs.tsx` — exact 1:1 match, derived from `nav-sections.ts` | 0 — single shared instance | REBUILD (port as-is) |
| **FilterBar** | `search`, `onSearch`, `placeholder`, `filters: FilterDef[]` | `modules/tasks/components/board-filters.tsx` → `TaskFilters()` (lines 109-233) — exact anatomy match (`minmax(200px,2fr) repeat(auto-fit,minmax(140px,1fr))` grid) | 1 (Task Board only — sole source per README) | REBUILD (extract `TaskFilters` into shared `FilterBar`) |
| **PageTabs** | `tabs: {key,label,icon}[]`, `activeKey`, `onSelect`, `onClose` | `apps/web/src/components/shared/open-tabs-bar.tsx` — exact match; full behavior in **§D.9** | 0 — single shared instance | REBUILD (port as-is, preserve all §D.9 behavior) |
| **TabStrip** | `tabs: {key,label,count?,note?}[]`, `activeKey`, `onChange` | `modules/tasks/components/board-filters.tsx` → `TaskTabs()` (lines 33-97) — exact match (`role="tablist"`, 3px blue underline) | 1 (Task Board only) | REBUILD (extract `TaskTabs` into shared `TabStrip`) |
| **TopNav** | `sections`, `activeKey`, `openKey`, `onToggle`, `onPick`, `currentPage`, `right`, `initials` | `apps/web/src/components/shared/top-nav.tsx` (213 lines) — exact 1:1 match; full behavior in **§D.8** | 0 — single shared instance | REBUILD (port; carries real access-control gating logic design-ref doesn't model) |

### layout/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **DetailHeader** | `backLabel`, `onBack`, `code`, `name`, `badges`, `actions`, children | Pattern hand-rolled per module, e.g. `clients/routes/detail.tsx` lines 72-98 (`ArrowLeft` + `panel-hdr`) | **62 files** import `ArrowLeft` for this back-button pattern, e.g. `alerts/routes/{config,drill}.tsx`, `assembly/routes/detail.tsx`, `bom-master/routes/detail.tsx`, `clients/routes/{detail,edit}.tsx`, `cost-centers/routes/{detail,edit,new}.tsx`, `delivery-challans/routes/{create,detail,receive}.tsx`, `goods-receipt-notes/{components/unified-grn-form,routes/detail,routes/edit}.tsx` | CONSOLIDATE (62 files — large win) |
| **ReadGrid** | `cols?` (deprecated), children — same 12-col grid as FormGrid | Local per-module grid wrappers, e.g. `clients/routes/detail.tsx` `DetailGrid()` using `className="form-grid"` | Same universe as ReadField (below) | CONSOLIDATE (with ReadField) |
| **ReadField** | `label`, `value`, `size`, `mono`, `pre` | Local `Pair()` in `clients/routes/detail.tsx` — same `.form-grp`/`.form-label` CSS edit-mode `FormField` uses, but reimplemented as a separate read-only local component per page | **21 `*/routes/detail.tsx` files** re-declare this locally: `bom-master`, `clients`, `cost-centers`, `delivery-challans`, `goods-receipt-notes`, `invoices`, `items`, `job-work-orders`, `jw-dc`, `machines`, `nc-register`, `operators`, `production-orders`, `purchase-orders`, `purchase-requests`, `qc-processes`, `route-cards`, `sales-orders`, `tpi-masters`, plus `tasks/components/task-detail-body.tsx` | CONSOLIDATE (21 files) |
| **DocCard** | `accent`, `expanded`, `onToggle`, `code`, `onOpen`, `title`, `badges`, `actions`, `metrics` (QtyStrip), `meta[]`, children | `sales-orders/routes/list.tsx` (`accentFor()` line 270, accent bar line 459) and `goods-receipt-notes/routes/list.tsx` (`accentFor()` line 148, line 325) each hand-roll the identical accent-bar+expand anatomy independently | **13 files total**: 6 list pages (`sales-orders`, `goods-receipt-notes`, `job-work-orders`, `job-cards` — each with own `accentFor`; `purchase-orders/routes/list.tsx` + `purchase-orders/components/po-sheet-table.tsx`; `sales-orders/components/so-sheet-table.tsx`) + 7 standalone `*-card.tsx` files (`customer-dispatches/components/dispatch-card.tsx`, `delivery-challans/components/dc-card.tsx`, `job-cards/components/{jc-op-card,jc-op-edit-card}.tsx`, `op-entry/components/machine-card.tsx`, `party-grn/components/party-grn-card.tsx`, `purchase-requests/components/pr-card.tsx`) | CONSOLIDATE (13 files) |
| **LinesPanel** | `title`, `code`, `onOpenDetail`, children — "▸ LINE ITEMS — CODE / Open full detail →" | `sales-orders/routes/list.tsx` line 724 + `goods-receipt-notes/routes/list.tsx` | 2 files | CONSOLIDATE (bundle with DocCard) |
| **ListFooter** | `total`, `shown`, `noun`, `limit`, pager props, `hint`, `actions` | `clients/routes/list.tsx` lines 486-542 — "Showing N of M …" + 💡 hint + Excel import buttons | **32 files** match "Showing X of Y" wording — the SO/GRN/PO/JC/JWO list family | CONSOLIDATE (32 files) |
| **ListHeader** | `title`, `icon`, `count`, `noun`, `filterNote`, `search`/`onSearch`, `updating`, `tools`, `primary`, children (StatStrip/StatusPills) | `clients/routes/list.tsx` lines 184-276 — sticky band, `section-hdr` title, count line, search, "Updating…" spinner, primary button, `<StatStrip>` — near-exact toolbar order match | **~97 files** use `section-hdr`; ~92 use `panel-hdr` — every list route hand-rolls this band (SO, GRN, PO, JWO, JC, Items, Vendors, Clients, Cost Centers, BOM Master, Route Cards, Purchase Requests, etc.) | CONSOLIDATE — **the single biggest win in the whole audit** |
| **PageState** | `state: loading\|error\|empty\|noaccess`, `message`, `as: panel\|row\|inline\|page`, `colSpan` | `clients/routes/list.tsx` (loading/error/empty rows) and `clients/routes/detail.tsx` (loading/error/noaccess blocks) — each module writes its own copy with the same wording | **206 files** with inline loading spinners; **61 files** repeat the exact sentence "This page is hidden for your access. Ask an admin if you need access to it." Also absorbs `components/shared/error-boundary.tsx`'s crash screen (see §C) | CONSOLIDATE — second-biggest win (206 + 61 sites) |
| **RowActions** | `onView`, `onEdit`, `onDelete`, `extra`, `labelled` | `clients/routes/list.tsx` lines 429-477 — `Eye`/`Pencil`/`Trash2` icon buttons, `stopPropagation()`, delete gated behind `confirm()` | **45 files** match the `Eye`/`Pencil`/`Trash2` triad: `bom-master/{components/bom-form,routes/detail,routes/list}.tsx`, `clients/routes/{detail,list}.tsx`, `cost-centers/routes/{detail,list}.tsx`, `goods-receipt-notes/{components/goods-receipt-note-form,routes/detail}.tsx`, `items/routes/{detail,list}.tsx`, `job-cards/components/{jc-row-write-actions,jc-status-view}.tsx`, `job-cards/routes/{edit,list}.tsx` (+30 more) | CONSOLIDATE (45 files). Delete must route through the new ConfirmDialog (§feedback), never own the confirm logic itself |
| **StatusPills** | `options`, `value`, `onChange`, `allLabel`, `right` | `sales-orders/routes/list.tsx` lines 354-370 — rounded (999px) pills per `SO_STATUSES`, `btn-primary` active | **5 files**: `bom-master/routes/list.tsx`, `goods-receipt-notes/routes/list.tsx`, `op-entry/components/op-log-history.tsx`, `plans/routes/list.tsx`, `sales-orders/routes/list.tsx` | CONSOLIDATE (5 files) |
| **ViewToggle** | `value: list\|card`, `onChange`, `expandAll`, `onExpandAll` | Same block as StatusPills (Expand all/Collapse all) plus a separate List/Card toggle | Expand/Collapse-all: **3 files** (`customer-dispatches`, `goods-receipt-notes`, `sales-orders` list routes). List/Card toggle: **4 files** (`job-cards/routes/list.tsx`, `purchase-orders/components/po-sheet-table.tsx`, `purchase-orders/routes/list.tsx`, `sales-orders/routes/list.tsx`) | CONSOLIDATE (up to 6 files) |
| **WorkList** | `title`, `items[]`, `emptyText`, `more` | `modules/dashboard/components/my-work-panel.tsx` (109 lines) — exact match already: severity left-border, age chip, action button | 1 real component, close to spec, not module-reusable | REBUILD (promote its row-rendering into a shared `WorkList` API) |
| **AttentionList** | `items: {icon,label,severity,onClick}[]`, `emptyText` | `modules/dashboard/components/home-admin.tsx` lines 159-215 — "Needs Attention" block hand-rolled inline, not its own component | 1 file, inline | CONSOLIDATE/NEW (extract into shared `AttentionList`) |
| **StatRow** | `icon`, `label`, `value`, `onClick` | `modules/dashboard/components/home-admin.tsx` lines 9-48 — local `StatRow()`, near-exact match, not reused even within dashboard (`my-work-panel.tsx`/`home-widgets.tsx` have visually similar but separately-coded stat cells) | 1 file, locally duplicated | CONSOLIDATE (extract into shared `StatRow`) |
| **QuickLinks** | `links: {icon,label,color,onClick}[]`, `title` | `modules/dashboard/components/quick-links.tsx` (29 lines) — exact match, already used by `home-admin.tsx`, `home-alerts.tsx`, `home-widgets.tsx` | 1 shared component, already correctly centralized | REBUILD (port as-is) |

### print/

| Design component | Props (abbreviated) | Current app file(s) | # inline re-implementations | Action |
|---|---|---|---|---|
| **PrintDocument** | `title`, `company`, `recipient`, `meta[]`, `lines[]`, `priced?`, `totals`, `notes`, `terms`, `pan`, `testBanner`, `logoSrc` | **Design-ref's own `PrintDocument.prompt.md` is stale/wrong** — it says "Arial 12px, greyscale," contradicting the user's documented FINAL print standard. The real standard is `apps/web/src/lib/print/sheet-print.ts` (761 lines, `buildSheetHtml`/`openSheetPrintWindow`) — `SHEET_STYLE` (line 194-197) hard-codes `"Times New Roman",Times,serif` for every font token, code comment: "TIMES NEW ROMAN THROUGHOUT, ON ALL FIVE DOCUMENTS." One `<table>`, repeating `<thead>` letterhead, 3 column-set variants (challan/po/grn), Indian number format, amount-in-words | 7 real callers on the correct standard: `modules/purchase-orders/lib/print-po.ts`, `modules/delivery-challans/lib/print-ospdc.ts`, `modules/jw-dc/lib/print-jwdc.ts`, `modules/goods-receipt-notes/lib/print-grn.ts`, `modules/jw-invoices/lib/print-jw-invoice.ts`, `modules/job-cards/lib/print-job-card.ts`, `modules/print-templates/lib/test-print.ts` (+`routes/editor.tsx`) | REBUILD — spec from `sheet-print.ts`, **NOT** from `PrintDocument.prompt.md`'s Arial description. `apps/web/src/lib/print/doc-print.ts`'s `buildDocHtml`/`openDocPrintWindow` (the old box-in-box builder) is confirmed **dead code** (0 callers outside its own file/test) — DELETE that path only; keep `doc-print.ts`'s still-used util exports (`esc`, `nl2br`, `fmtDate`, `inrFormat`, `amountInWords`, `COMPANY_PAN`, `templatesToBlocks`), which `sheet-print.ts` itself imports. Note: `print-window.ts`'s generic `printWindow()` is still used by daily report / dispatch register / drawing print / machine queue / route card print flows — those are separate, NOT-yet-migrated print paths outside PrintDocument's scope |

---

## B. Status-badge consolidation

`design-ref/components/core/StatusBadge.jsx` defines ONE component with an internal `MAP` keyed by `kind`,
mapping status → tone (`blue|green|amber|cyan|red|grey|orange|''`):

```
so:        draft:amber, open:blue, closed:green, dispatched:cyan, cancelled:grey
jc:        open:grey, qc_pending:amber, complete:cyan, closed:green, no_ops:red
jcop:      waiting:red, available:blue, in_progress:'', running:'', qc_pending:amber, complete:green,
           pr_raised:amber, po_created:blue, at_vendor:'', received:cyan, ready_for_pr:amber, outsource:amber
pr:        open:amber, approved:blue, po_created:green, cancelled:red
po:        draft:grey, open:blue, partial:amber, qc_pending:amber, closed:green, cancelled:grey
prodorder: open:amber, partially_closed:blue, closed:green
grnqc:     pending:amber, in_progress:blue, completed:green
dc:        issued:amber, received:green, cancelled:grey
nc:        pending:amber, disposed:blue, under_rework:amber, under_repair:amber, sent_to_vendor:blue,
           received_qc_pending:blue, rework_done:cyan, closed:green
ncdisp:    rework:cyan, repair:cyan, scrap:red, use_as_is:green, return_to_vendor:orange, make_fresh:blue
txn:       in:green, out:amber, adjust:grey
```
Note: design-ref itself already encodes `jcop.complete = green` while `jc.complete = cyan` — two colors for
"complete" depending on whether it's a JC-op or the JC header. `jcop.in_progress`/`running`/`at_vendor` are
deliberately unfilled (`''`) to match legacy rendering.

### Files found

**A. Dedicated `*-status-badge.tsx` files (8) — all match design-ref's MAP exactly for their kind:**

| File | Kind | Status → color |
|---|---|---|
| `modules/sales-orders/components/so-status-badge.tsx` L6-12 | SO | draft:amber, open:blue, closed:green, dispatched:cyan, cancelled:grey |
| `modules/job-cards/components/jc-status-badge.tsx` L6-12 | JC | open:grey, qc_pending:amber, complete:cyan, closed:green, no_ops:red |
| `modules/purchase-requests/components/pr-status-badge.tsx` L9-14 | PR | open:amber, approved:blue, po_created:green, cancelled:**red** |
| `modules/purchase-orders/components/po-status-badge.tsx` L7-14 | PO | draft:grey, open:blue, partial:amber, qc_pending:amber, closed:green, cancelled:grey |
| `modules/production-orders/components/po-status-badge.tsx` L10-16 | Production Order | open:amber, partially_closed:blue, closed:green |
| `modules/goods-receipt-notes/components/qc-status-badge.tsx` L6-10 | GRN QC | pending:amber, in_progress:blue, completed:green |
| `modules/delivery-challans/components/dc-status-badge.tsx` L7-11 | DC | issued:amber, received:green, cancelled:grey |
| `modules/nc-register/components/nc-status-badge.tsx` L14-23 | NC | pending:amber, disposed:blue, under_rework:amber, under_repair:amber, sent_to_vendor:blue, received_qc_pending:blue, rework_done:cyan, closed:green |

**B. Other dedicated badge files (found via content grep, not the glob):**

| File | Kind | Mapping |
|---|---|---|
| `modules/op-entry/components/status-badge.tsx` L13-26 (`JcOpStatusBadge`) | JC-op | matches design-ref `jcop` exactly |
| same file L28-32, L53-62 (`RunningOpStatusBadge`) | run | running/done/stopped — **the only status badge in the app built with raw Tailwind utility classes** (`bg-green-500/15 text-green-700 dark:text-green-300`) instead of the `badge b-<tone>` system every other badge uses. Semantically equivalent (green/grey/red) but structurally different — the rebuild must decide whether `StatusBadge kind="run"` replaces it |
| `modules/store-transactions/components/txn-type-badge.tsx` L6-10 | Store txn | matches design-ref `txn` exactly |

**C. Inline status-color-switch patterns (no dedicated file) — the real problem area:**

`modules/sales-orders/components/so-status-detail.tsx` (the SO Status Review screen) has **four separate
local color systems for JC-status concepts, none importing the real `JcStatusBadge`:**
- L49-54 `LINE_STATUS_COLOR` (SO-line status): complete→green, qc_pending→amber, no_jc→text3, in_progress→**cyan**
- L616 `jcColor` inline ternary (per-JC row): complete→green, qc_pending→amber, else (in_progress)→**cyan**
- L762-771 a **local `JcStatusBadge` function that shadows the real one** (same name, different file): complete→green, qc_pending→amber, in_progress→**blue**, no_ops→grey
- L713-722 `opChipColor` (per-op chip): complete→green, {qc_pending,in_progress,running}→amber, outsource variants→purple/blue/amber, else→text3

Other inline sites checked and found to **match** their canonical badge (no conflict): `nc-register/routes/list.tsx` L54-68 `accentForNc`, `delivery-challans/components/dc-card.tsx` L19-23 `accentFor`, `production-orders/routes/list.tsx` L364-393 StatStrip tiles. Also noted (different concept, not a status conflict): `job-work-orders/components/jw-material-status.tsx` (computed Full/Partial/Not-received, not a status enum) and `purchase-requests/components/pr-card.tsx`'s `prBalanceColor` (order-balance state, deliberately separate from PR status per its own comments).

### Flagged: real inconsistencies

1. **"open"** — blue in SO and PO status badges; **grey** in JC status badge; **amber** in PR and Production-Order status badges. No single global meaning for "open" exists — a shared `StatusBadge` cannot assume one.
2. **"cancelled"** — grey in SO/PO/DC; **red** in PR (`pr-status-badge.tsx` L2-5 documents this as an intentional legacy-fidelity choice, not an oversight).
3. **"complete"** — **cyan** in the canonical `jc-status-badge.tsx` (JC header) but **green** in `op-entry/components/status-badge.tsx`'s JC-op `complete` AND green in all three of `so-status-detail.tsx`'s local maps. This is the highest-risk one: a user sees "JC complete" as cyan on the Job Card pages, then "complete" rendered green three different ways on the SO Status Review page for what reads as the same fact.
4. **`so-status-detail.tsx`'s local `JcStatusBadge` (L762-771) shadows the real, canonical `job-cards/components/jc-status-badge.tsx` `JcStatusBadge`** — same component name, disjoint status set, disjoint colors (`complete`: green vs cyan, `no_ops`: grey vs red). **This is the clearest single consolidation target** in the whole status-badge sweep.
5. **Within `so-status-detail.tsx` itself**, `in_progress` is blue in the local `JcStatusBadge` (L766) but cyan in `LINE_STATUS_COLOR`/`jcColor` (L52, L616) — two local systems in the same file disagree with each other.
6. **"received"** — green in `dc-status-badge.tsx` (DC received back from vendor, terminal-good) vs **cyan** in `op-entry` jcop `received` (goods just arrived, mid-state, labeled "Incoming QC"). Different domains, opposite semantic weight, worth flagging for anyone building a generic "received" chip.
7. **"po_created"** — green in `pr-status-badge.tsx` (terminal-good) vs **blue** in `op-entry` jcop `po_created` (mid-state, work hasn't started).
8. **Style inconsistency (not a color conflict):** `RunningOpStatusBadge` is the only badge built on raw Tailwind classes instead of the `badge b-*` system.

---

## C. App-only components with no design equivalent

### Group 1 — the four README-named "not built" items, confirmed + completed

- **MachineSplit** — `apps/web/src/components/shared/machine-split.tsx` — not one component but a family of pure-function renderers (ADR-126/164): `MachineChip` (⚙ warning glyph when completed qty was made on a different/multiple machine), `MachineSplitLines`/`ActualMachineLine` (per-machine qty breakdown under a Done figure), `PlannedActualMachine` (two-line PLANNED/ACTUAL cell, amber on disagreement). All render `null` when nothing disagrees. **Treatment:** bundle as a **MachineCard variant/slot** (optional planned-vs-actual sub-row + `⚙N` chip), not a standalone new component.
- **GlobalSearch popup results** — `components/shared/global-search.tsx` (header box, Ctrl+K, debounced) + `modules/search/components/search-popup.tsx` (the actual full-window results overlay: Document Date | Type | No. | Customer/Vendor | Particulars | Qty | Status, plus a kind-filter count strip). Two distinct files, always paired. **Treatment:** genuinely new bespoke component (overlay + DataTable + StatStrip-like filter internally, but the anchored-under-top-bar / dismiss-vs-escape overlay pattern needs its own documented spec).
- **SearchPopup** — same file, `modules/search/components/search-popup.tsx` — confirmed to be the results overlay itself, not a separate concept.
- **AssignTaskModal** — `modules/tasks/components/assign-task-modal.tsx` — 600px modal (ADR-176): Title, Description, `UserPicker` (custom avatar+name combobox), Priority, Start/Due Date, dependent Related-To-type + SearchableSelect reference, multi-file attachment. **Treatment:** variant of Modal + FormGrid (already composes SearchableSelect + native file input); only `UserPicker` is a small genuinely-new control (minor SearchableSelect variant).
- **"the report Builder"** — `modules/saved-reports/components/builder.tsx` — native HTML5 drag-and-drop ad-hoc report designer: Data Source chips, draggable "Available Fields," three drop zones (Excel Columns / Filters / Group By), Preview/Generate-Excel/Clear, live preview table. All inline styling (`CHIP`, `ZONE_TITLE`), not theme-mapped. **Treatment:** genuinely new bespoke component — nothing in the kit covers drag-and-drop chip/zone assignment.

### Group 2 — additional `components/shared/` files not covered by the README

Of 22 files, 15 map directly (searchable-select, doc-number-input, line-item-picker, item-badge, sortable-th, sortable-head, related-docs-tabs, related-docs-panel, qc-report-attach, top-nav, stat-strip, open-tabs-bar, breadcrumbs, file-preview-modal; `doc-number-input.test.tsx` is a test). The remaining 7:

- **machine-split.tsx**, **global-search.tsx** — covered above.
- **`error-boundary.tsx`** — React class error boundary; full-screen crash panel on render error, reports to Sentry, uses shadcn `Button`/Tailwind (not theme tokens). **Treatment:** fold into **PageState's "error" variant** rather than staying an unstyled one-off.
- **`qc-process-picker.tsx`** — confirmed a thin domain wrapper around SearchableSelect (searches QC Process master, stores the NAME not an id). **Treatment:** no new component — already covered by SearchableSelect.
- **`vendor-picker.tsx`** — same pattern, thin SearchableSelect wrapper for vendor fields + a "Saved as free text" fallback note. **Treatment:** no new component; the fallback-note pattern could become a ReadField/FormField footnote variant.
- **`nav-sections.ts`** — data file (emoji/label/route table), not a component.
- **`search-match.ts`** — search-normalization utility, not a component.

### Group 3 — additional module-level widgets found in the sweep

- **Production Schedule (Gantt)** — `modules/production-schedule/routes/list.tsx` — 30-day machine-row scheduling grid with drag-and-drop rescheduling. **Treatment:** genuinely new bespoke component — no date-axis Gantt pattern exists in the kit.
- **Design Task Kanban board** — `modules/design-projects/routes/detail.tsx` (~lines 293-450) — Table/Kanban toggle; Kanban columns by `DESIGN_TASK_STATUSES`. Distinct from the main Task Board (`modules/tasks/routes/board.tsx`, which is NOT a Kanban — already fully expressible via StatStrip + TabStrip/FilterBar + DataTable). **Treatment:** genuinely new bespoke component — a status-column card board.
- **Machine Loading's own machine card** — `modules/machine-loading/routes/list.tsx` (~lines 4, 222-271) — explicitly commented "cards use inline tokens (`.mach-card` not ported to theme)"; a *different* card markup from the design-ref-covered MachineCard. **Treatment:** consolidate onto MachineCard as a variant, not a new component.
- **Print Templates block editor** — `modules/print-templates/routes/editor.tsx` — admin screen: per-doc-type block textarea with cursor-position variable insertion (`insertVar`), a live preview that duplicates `sheet-print.ts`'s `PO_RULE`/`PO_BAND` constants inline instead of sharing them, "Reset to factory default," Revisions modal (reuses Modal). **Treatment:** genuinely new bespoke component (variable-insertion textarea + live preview split pane) — and the rebuild should fix the duplicated print-token constants to reference `sheet-print.ts` directly.

### Checked and ruled out (no gap)
No chart/graph library anywhere (no recharts/Chart.js/d3/victory/nivo). No signature-pad, barcode/QR, or custom date-range-picker exists. No rich-text/WYSIWYG editor or PDF viewer (Print Templates editor is textarea+preview, not contenteditable). No notification-bell dropdown in TopNav — alerts surface only via the dashboard's `HomeAlerts` table, already expressible with Banner + DataTable. Running Ops Board / Shop Floor View / QC Command QueueTab are ordinary DataTable screens using the already-flagged `machine-split.tsx` helpers.

---

## D. Behaviour that MUST be preserved

### D.1 — SearchableSelect (`apps/web/src/components/shared/searchable-select.tsx`)
Presentational combobox, no owned data — caller supplies `options` (current page) and `onSearch`. Opens on focus, click, **or ArrowDown**. Renders its listbox via `createPortal` to `document.body` (ancestor `overflow:hidden` panels used to clip it) at `zIndex: 1000`, position tracked via a scroll/resize listener pair in capture phase, flipping to `placement: 'above'` when there's more room above. Typing → `handleInput`: updates `query`, force-opens, **clears any prior selection** (`if (value) onChange(null)`), and debounces `onSearch` at **exactly 250ms** (`setTimeout(..., 250)`). Filtering is two-layer: server does whatever `onSearch` requests, plus a client-side substring (not prefix) refine over `"CODE — Name"`.
**MUST NOT CHANGE:** the three open-triggers; the 250ms debounce constant; "typing clears prior selection"; substring (not prefix) client refine; keyboard map (ArrowDown opens+moves+clamps, ArrowUp moves+clamps but does NOT auto-open, Enter picks only if `open && filtered[highlight]`, Escape closes but keeps value); `onChange` always receives an id, never label text; portal-to-body + `zIndex:1000`; capture-phase outside-mousedown close checking both `containerRef` and the portal `listRef`; loading/empty states; full aria wiring (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`, listbox `role="listbox"`, options `role="option"`+`aria-selected`); the `valueLabel` two-way sync (shows a pre-selected label even if its id isn't on the current options page); on-open re-sync of the caller's search term bypassing debounce (prevents stale shared search state leaking between sibling pickers).

### D.2 — DocNumberInput (`components/shared/doc-number-input.tsx` + `.test.tsx`)
Controlled wrapper over `useDocNumber(type, value, poType)`. On create, auto-fills `state.nextCode` the first time the box is empty, or again if the PO series (`poType`) changes and the box is still empty/still holds what the hook itself wrote — a user-typed value is never touched. On blur, non-empty value is replaced with `state.padded` (zero-pad) — test-verified: `"IN-SO-126"` → blur → `"IN-SO-00126"`. Status icon/border/text switch on `checking`/`error`/valid.
**MUST NOT CHANGE (test-verified):** prefill-when-empty; exact "✓ Available" green text; exact "Duplicate — this number already exists" text; exact "Invalid format — expected IN-SO-NNNNN" text (client-side, no backend hit for malformed input); the blur auto-pad behavior; `readOnly` mode never prefills/checks, shows "Code cannot be changed after creation."; `poType` selects the prefix series; status icon only shown when `!readOnly && value.trim().length > 0`.

### D.3 — LineItemPicker (`components/shared/line-item-picker.tsx`)
Uses a native `<input list={dlId}>` + `<datalist>` (**deliberately not SearchableSelect** — "mirrors the long-standing PO line pattern") sourced from `useItemsList({limit:1000,offset:0})`, deduped via TanStack Query cache across rows. Exact case-insensitive code match (`itemsByCode.get(code.trim().toUpperCase())`) auto-fills `itemId`+`name` and locks Name read-only; no match clears `itemId` to null but **leaves the typed name alone** (off-master items allowed) — this deliberately differs from `useFieldCascade`'s "miss resets everything" rule.
**MUST NOT CHANGE:** native datalist (not a custom combobox); exact-match-only, no fuzzy matching; Name lock only on match, with the exact `title` tooltip; miss does NOT clear the name field; per-instance `useId()` for the datalist id.

### D.4 — use-field-cascade (`apps/web/src/lib/use-field-cascade.ts`)
Used in 7 files: `sales-orders/components/sales-order-form.tsx`, `purchase-requests/components/purchase-request-form.tsx`, `purchase-orders/components/{po-form,po-line-row,po-form-line}.tsx`, `job-work-orders/components/job-work-order-form.tsx`. One controller value drives N dependent RHF fields. First run on a given key is a **baseline only** (no cascade) unless `runOnMount: true` — protects edit forms from wiping saved dependents on load. Subsequent changes: match → fill via `field.fill()`, recorded in an `owned` Map; miss → reset to `empty` UNLESS `userEditable` and the user has typed over it (compared via `Object.is` against `owned`). `keepUserEdits` fields only refill while still empty/still-owned. Race handling: each run gets an incrementing `requestId`; a stale async resolve is dropped entirely — a dropped request does **not** reset fields ("a dropped network request is not evidence the code is off-master").
**MUST NOT CHANGE:** baseline-first-run behavior; the `owned`-Map identity tracking; the stale-reply guard; "match fills all listed fields, miss resets all listed fields" symmetry; `userEntered` hard-block list overrides everything; `enabled:false` full inertness.

### D.5 — ItemBadge (`components/shared/item-badge.tsx`)
Fixed-size `ItemImageBox` (row=40/card=56/page=96/tile=120px) beside CODE/REV (mono `fw-700`, `var(--purple)` default in lists, overridable) over item name. Image click and text click are **two separate handlers** — image click does `stopPropagation`/`preventDefault` since badges sit inside clickable rows. `object-fit:cover` for row/card/page vs `contain`+padding for tile only. `rowLayout` pins the image flush-left with a `width:100%` flex container so the picture never "dances" with varying code/name length (explicit named anti-regression in the code).
**MUST NOT CHANGE:** the two-handler split with stopPropagation; CODE renders `mono fw-700` — never dilute to `text3` (the item-code-is-the-main-thing rule); `object-fit` split by size; the flush-left row layout; keyboard support (`role="button"`, `tabIndex={0}` only when `hasImage`, Enter/Space triggers open); `ItemThumbnailCell`/`ItemThumbnailHeader` pairing kept separate from the inline-badge pattern; failed-image fallback resetting per new signed URL.

### D.6 — SortTh vs SortableHead (`components/shared/sortable-th.tsx`, `sortable-head.tsx`)
**Not duplicates — two different sort models.** `SortTh`/`nextSort()` (currently dead code, 0 importers) is for **server-paginated** lists: 3-state cycle (asc→desc→none), caller stores sort state (typically URL params) and re-queries the API. `SortableHead` (2 importers: `production-orders/routes/list.tsx`, `so-planning/routes/workflow.tsx`) is for **client-side** TanStack Table sorting of already-loaded rows, using `getCanSort()`/`getIsSorted()`/`getToggleSortingHandler()`, plus `aria-sort`.
**MUST NOT CHANGE:** keep both models distinct — merging them into "one sortable header" breaks either server-paginated lists (once SortTh is revived for the ~120 unsorted `innovic-table` lists per §A/data) or client-sorted grids. Identical glyph convention (▼ desc/▲ asc/↕ none, `var(--cyan)` active) is an explicit intentional visual-parity requirement stated in the file comments — keep the glyphs identical between both.

### D.7 — StatStrip (`components/shared/stat-strip.tsx`)
Renders ONE `.panel` flex-row (never N separate cards) with hairline `border-left` dividers. Each item is one of **three distinct element kinds** based on which prop is set: `to` → real `<Link>` (preserves middle-click/ctrl-click/new-tab — explicitly not `onClick`+`navigate()`); `onClick` → real `<button>` with `aria-pressed`; neither → plain `<div>` (read-only total, deliberately not announced as interactive). Active state = 2px bottom border in the item's color, **never** a ring/box (explicit anti-pattern named in the code comment).
**MUST NOT CHANGE:** the three-kind branching; `<Link>` for navigation (never button+navigate); bottom-border-only active indicator; `aria-pressed` present ONLY on the button variant, explicitly absent on Link (a documented decision — that attribute would misrepresent where the click goes).

### D.8 — TopNav (`components/shared/top-nav.tsx`)
54px band: logo → Dashboard → one button per visible module → GlobalSearch/sync dot/change-password/sign-out/avatar. `openKey` (one menu open at a time) persists to **sessionStorage** (`innovic.topnav.open`) — explicit user decision: picking a page **leaves the menu open** so an operator can move between a module's pages without reopening. `flip` (menu opens leftward near screen edge) is recomputed fresh from `getBoundingClientRect()` on every open, not cached (module count varies by access). Outside-click/Escape listeners register only while a menu is open, and the outside-click check **excludes** `.overlay, [role="dialog"], [role="alertdialog"]` — so answering a nav-triggered confirm dialog doesn't also close the menu underneath it. Active-route highlighting via prefix match.
**MUST NOT CHANGE:** single `openKey` (not per-button booleans); sessionStorage persistence (tab-scoped, not localStorage); the dialog-exclusion in outside-click; `aria-haspopup="menu"`/`aria-expanded`/`role="menu"`/`role="menuitem"`; click-time `flip` measurement; per-item "Hide page" gating (`canViewForm`), admin bypass; the Approvals badge query staying fully disabled (never fires) for non-approvers.

### D.9 — OpenTabsBar (`components/shared/open-tabs-bar.tsx`, store: `@/stores/open-tabs`)
Tabs are added **automatically on navigation** (no explicit "pin" action) via a `useEffect` keyed on the route. `resolve(pathname)` maps the path to a nav entry by longest-`to`-match (must stay in sync with the breadcrumb's own longest-match logic — a documented cross-file consistency requirement). Closing the **active** tab must navigate away (else the route-change effect immediately re-adds it) — fallback chain: left neighbor → first remaining tab → `/`. Renders `null` (not empty chrome) when zero tabs.
**MUST NOT CHANGE:** automatic tab-on-navigate; longest-match resolution kept in sync with Breadcrumbs; the close-active-tab navigation fallback chain; `<Link>` wrapping with the × button doing `preventDefault`+`stopPropagation`; no max-tab/overflow logic exists today — if the redesign wants one, it's a **new** behavior to flag separately, not a preserved one; `null` render at zero tabs.

### D.10 — requireFormAccess (server: `apps/api/src/lib/access.ts` L58-83; client mirror: `apps/web/src/lib/access-control.ts` + `packages/shared/src/schemas/access-control.ts`)
Server, throwing/async: admins bypass unconditionally; otherwise checks `effectiveFormPerms(eff, formKey)[action]` (`action` ∈ `view|entry|edit|approve`), throwing `AuthorizationError` with a generic "not configured" message or a specific per-action message. Called **192 times across 47 files**. `AccessFormPerms` shape: `{view, entry, edit, approve, price, priceOff, viewOff, entryOff, editOff, approveOff}` — all booleans, grants are **unioned** (tier ∪ per-form ticks ∪ auditor) except the OFF switches and `priceOff`, the one sanctioned way to subtract a single action below tier. `viewOff` cascades — hides the whole page and everything else with it. Client mirror (`useMyAccess()`, TanStack Query, `staleTime: 60_000`) exposes `canViewForm`/`canEntryForm`/`canEditForm`/`canApproveForm`/`canSeePrice` for UI-hiding only; 6 files actually consume these client-side (`top-nav.tsx`, `nav-sections.ts`, `nc-register/routes/detail.tsx`, `nc-register/components/dispose-nc-panel.tsx`, `alerts/routes/config.tsx`).
**MUST NOT CHANGE:** the exact `AccessFormPerms` key set (every consumer destructures these names); `viewOff` as a hard short-circuit over all other actions, not an independent flag; client checks stay UI-only convenience — server's throw is the real enforcement (never remove the server check, never treat the client one as sufficient); admin bypass first in the chain on both sides; deny-by-default for an unconfigured account (a documented 2026 security posture flip — never revert to allow-all).

**General rebuild risk (cross-cutting):** the real danger in a purely-visual reskin is (a) breaking SearchableSelect's/TopNav's `document.body` portal + capture-phase listener patterns via a DOM-structure change, (b) losing aria-* wiring while restyling, (c) collapsing SortTh/SortableHead into one component, (d) collapsing StatStrip's three element-kind branches into one shape.

---

## E. Proposed target folder layout — `apps/web/src/ui/`

Mirrors design-ref's 7 categories. Every file below is either a straight port (REBUILD/NEW rows above) or
the named consolidation target for the files listed in §A. Domain-specific wrappers that are *not* generic
primitives (qc-process-picker, vendor-picker, nav-sections.ts, search-match.ts, machine-split.tsx) stay
where they are — under `components/shared/` or their owning module — and just import from `ui/` instead of
hand-rolling markup.

```
apps/web/src/ui/
├── core/
│   ├── Badge.tsx                 # ← 38 inline `.badge` spans + shared base for StatusBadge
│   ├── Button.tsx                # ← 229 inline .btn spans; retires components/ui/button.tsx
│   ├── Icon.tsx                  # ← thin lucide-react wrapper (fixed name set), 234 call sites migrate over time
│   ├── StatusBadge.tsx           # ← 10 *-status-badge.tsx files + RunningOpStatusBadge; kind-keyed MAP (§B)
│   ├── SyncDot.tsx                # ← top-nav.tsx inline <span className="sync-dot">
│   ├── Tag.tsx                   # ← 9 inline `.tag` spans
│   └── index.ts
│
├── forms/
│   ├── CheckField.tsx            # NEW — checkbox/radio wrapper, 15 raw <input type=checkbox> sites
│   ├── DocNumberInput.tsx        # ← components/shared/doc-number-input.tsx (port, preserve §D.2)
│   ├── FileField.tsx             # ← merges qc-report-attach.tsx + drawing-upload-field.tsx + item-image-field.tsx
│   ├── FormField.tsx             # NEW wrapper over existing .form-grp/.form-label CSS, 96 sites
│   ├── FormGrid.tsx              # NEW — .form-grid-12 does not exist in app CSS yet, add it here
│   ├── Input.tsx                 # ← 134 sites using .innovic-input raw
│   ├── LineItemPicker.tsx        # ← components/shared/line-item-picker.tsx (port, preserve §D.3 — keep native datalist)
│   ├── SearchInput.tsx           # ← extracted from global-search.tsx's gs-wrap/gs-icon markup, 22 bare-input sites
│   ├── SearchableSelect.tsx      # ← components/shared/searchable-select.tsx (port, preserve §D.1 in full)
│   ├── Select.tsx                # ← 85 sites using .innovic-select raw
│   ├── Textarea.tsx              # ← 30 sites (19 on-pattern, 11 drifted — fixes the drift)
│   └── index.ts
│
├── data/
│   ├── DataTable.tsx             # ← 123 innovic-table sites; sheet/list/frozen/auto/compact/edit variants; retires components/ui/table.tsx
│   ├── EmptyState.tsx            # ← 194 .empty-state sites
│   ├── ItemBadge.tsx             # ← components/shared/item-badge.tsx (port, preserve §D.5); exports ItemImageBox, ItemThumbnailCell/Header
│   ├── MachineCard.tsx           # ← op-entry/components/machine-card.tsx + machine-loading's .mach-card + 3 more; absorbs MachineSplit as a slot (§C)
│   ├── Panel.tsx                 # ← 180 .panel sites; retires components/ui/card.tsx (3 saved-reports consumers migrate)
│   ├── ProgressBar.tsx           # NEW — 16 hand-rolled bar sites
│   ├── QtyStrip.tsx              # NEW — 14 local QtyBox/StatFact/MetricBox helpers; exports Fact
│   ├── RelatedDocs.tsx           # ← merges related-docs-tabs.tsx (tab UI) + related-docs-panel.tsx (section UI)
│   ├── SortHeader.tsx            # ← sortable-head.tsx (client/TanStack) as the base; revive sortable-th.tsx's nextSort() model for server-paginated DataTable instances (§D.6 — do not merge into one shape)
│   ├── StatStrip.tsx             # ← components/shared/stat-strip.tsx (port, preserve §D.7 in full); StatCard/KpiTiles become deprecated aliases, not new files
│   ├── Timeline.tsx              # ← merges so-timeline/timeline-body.tsx (rail) + related-docs-panel.tsx's Timeline() (compact), density prop
│   └── index.ts
│
├── feedback/
│   ├── Banner.tsx                 # ← jc-recovery-banner.tsx + login.tsx inline banner + 23 role="alert" sites
│   ├── ConfirmDialog.tsx          # NEW, parametrized — replaces exit-guard.tsx's hardcoded ExitConfirmDialog usage pattern (guard keeps its own copy text but reuses this shell), 13 window.confirm + 17 inline "Delete?" swaps
│   ├── FilePreview.tsx            # ← components/shared/file-preview-modal.tsx (port; reconcile the two meanings of `kind`)
│   ├── Modal.tsx                  # NEW — 7 hand-rolled .overlay sites; becomes the shell ConfirmDialog/FilePreview/AssignTaskModal build on
│   ├── Toast.tsx                  # NEW — no current implementation exists at all, only dead CSS; add a small toast store/hook alongside
│   └── index.ts
│
├── navigation/
│   ├── Breadcrumbs.tsx            # ← components/shared/breadcrumbs.tsx (port as-is)
│   ├── FilterBar.tsx              # ← extracted from tasks/board-filters.tsx's TaskFilters()
│   ├── PageTabs.tsx               # ← components/shared/open-tabs-bar.tsx (port, preserve §D.9 in full)
│   ├── TabStrip.tsx               # ← extracted from tasks/board-filters.tsx's TaskTabs()
│   ├── TopNav.tsx                 # ← components/shared/top-nav.tsx (port, preserve §D.8 in full)
│   └── index.ts
│
├── layout/
│   ├── DetailHeader.tsx           # ← 62 files' hand-rolled ArrowLeft+panel-hdr pattern; exports ReadGrid, ReadField (← 21 local Pair()/DetailGrid() files)
│   ├── DocCard.tsx                # ← 13 files (6 list-page accentFor blocks + 7 standalone *-card.tsx); exports LinesPanel (← 2 files)
│   ├── ListFooter.tsx             # ← 32 "Showing X of Y" footer sites
│   ├── ListHeader.tsx             # ← ~97 section-hdr / ~92 panel-hdr sticky toolbar sites — biggest single consolidation in the app
│   ├── PageState.tsx              # ← 206 loading sites + 61 identical noaccess sites + error-boundary.tsx's crash screen (as the "error" variant)
│   ├── RowActions.tsx             # ← 45 Eye/Pencil/Trash2 triad sites; delete routes through the new feedback/ConfirmDialog, never owns confirm itself
│   ├── StatusPills.tsx            # ← 5 rounded-pill filter sites; exports ViewToggle (← up to 6 Expand-all/List-Card-toggle sites)
│   ├── WorkList.tsx               # ← promoted from dashboard/components/my-work-panel.tsx; exports AttentionList (← home-admin.tsx inline block), StatRow (← home-admin.tsx local fn), QuickLinks (← dashboard/components/quick-links.tsx, ported as-is, already correctly centralized)
│   └── index.ts
│
├── print/
│   ├── PrintDocument.tsx          # ← spec sourced from lib/print/sheet-print.ts (Times, one table, no box-in-box) — NOT from this component's own stale prompt.md
│   └── index.ts
│
└── index.ts                       # barrel re-export of all 7 category indexes
```

**Not moved into `ui/`** (stay as domain wrappers that consume the new primitives instead of hand-rolling):
- `components/shared/qc-process-picker.tsx`, `vendor-picker.tsx` — thin `SearchableSelect` wrappers.
- `components/shared/machine-split.tsx` — domain helper feeding `data/MachineCard.tsx`'s new slot.
- `components/shared/nav-sections.ts`, `search-match.ts` — data/utility files, not components.
- `apps/web/src/lib/access-control.ts`, `apps/web/src/lib/use-field-cascade.ts`, `apps/web/src/lib/use-doc-number.ts` — logic hooks, not UI; `ui/forms/DocNumberInput.tsx` and the 7 `useFieldCascade` consumers keep importing them from `lib/` unchanged.
- `modules/search/components/search-popup.tsx`, `modules/tasks/components/assign-task-modal.tsx`, `modules/saved-reports/components/builder.tsx`, `modules/production-schedule/*` (Gantt), `modules/design-projects/*` (Kanban), `modules/print-templates/routes/editor.tsx` — genuinely new, bespoke, module-owned components per §C; they may later import `ui/` primitives (Modal, DataTable, StatStrip) internally, but are not themselves general-purpose primitives.

**To delete once migrated:** `apps/web/src/components/ui/` (stale shadcn scaffold — 7 consumers: `error-boundary.tsx`, `searchable-select.tsx`'s internal `Input`, `saved-reports/{result-table,list,run}`, `login.tsx`, `reset-password.tsx`); `components/shared/sortable-th.tsx` only after its `nextSort()` model is revived inside `data/SortHeader.tsx` for server-paginated tables (§D.6) — do not delete it before that; `lib/print/doc-print.ts`'s `buildDocHtml`/`openDocPrintWindow`/print-window path only (keep its util exports, `sheet-print.ts` depends on them).
