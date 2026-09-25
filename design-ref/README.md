# Innovic ERP — Design System

Innovic ERP is a **manufacturing ERP / MES for a job-shop** (component machining, equipment assembly, job-work). It began as a 29,000-line single-HTML Firebase app and is being migrated to React + Fastify + Supabase Postgres. There is one product surface: the **web app** used by office staff and on shop-floor monitors — Sales & CRM, Design, Planning, Production, Purchase, Quality, Store, Finance, Tasks, Reports, Settings.

## Sources
- GitHub: https://github.com/vinay181186/innovicerp (branch `main`) — explore it further for any screen not recreated here.
  - `apps/web/src/styles/tokens.css` — token source of truth (2026-09 "Professional Industrial ERP / MES" theme)
  - `apps/web/src/styles/innovic-theme.css` — class vocabulary (`.panel`, `.btn`, `.badge`, `.innovic-table`, `.tn-*`, …)
  - `docs/STYLE_GUIDE.md`, `.claude/skills/styling/SKILL.md` — written rules (note: STYLE_GUIDE hex tables predate the 2026-09 retheme; tokens.css wins)
  - `apps/web/src/components/shared/*` — TopNav, StatStrip, OpenTabsBar, Breadcrumbs
  - `apps/web/src/modules/dashboard`, `modules/sales-orders` — screens recreated in the UI kit
- Referenced but not in repo: `legacy/InnovicERP_v82_12_3…html` (original spec) and `Innovic_ERP_Theme_Reference_and_Claude_Prompt.pdf`.

## Index
- `styles.css` — entry point (imports only) → `tokens/fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`, `components.css` (product class names, verbatim), `po-compact.css` (scoped `.pof-*` Create-PO palette), `print.css` (scoped `.print-doc` A4 documents)
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Tables, Brand incl. Iconography)
- `components/` — React primitives (see list below), each with `.jsx`, `.d.ts`, `.prompt.md`, one card per folder
- `ui_kits/erp/` — interactive recreation of the web app (`index.html`)
- `assets/innovic-logo.jpeg` — the only brand asset in the repo
- `SKILL.md`, `github.md`, `thumbnail.html`

### Components
- **core/** — Button, Badge, Tag, StatusBadge (+ PriorityText), SyncDot, Icon
- **forms/** — SearchInput, Input, Select, Textarea, FormField (+ FormGrid), DocNumberInput, SearchableSelect, LineItemPicker, FileField (attach / drawing / image), CheckField (checkbox / radio)
- **data/** — Panel, StatCard, StatStrip, DataTable (list / sheet / frozen), ProgressBar, EmptyState, ItemBadge (+ ItemImageBox), SortHeader, QtyStrip (+ Fact), KpiTiles, Timeline (rail / compact), RelatedDocs, MachineCard
- **feedback/** — Modal, Toast (+ ToastStack), ConfirmDialog, Banner, FilePreview
- **navigation/** — TopNav, PageTabs, Breadcrumbs, TabStrip, FilterBar
- **print/** — PrintDocument
- **layout/** (page-level canonical patterns) — ListHeader, StatusPills (+ ViewToggle), ListFooter (scroll count or Prev/Next pager), RowActions, DetailHeader (+ ReadGrid, ReadField), PageState (loading / error / empty / no-access), DocCard (+ LinesPanel), WorkList (+ AttentionList, StatRow, QuickLinks)

Source mapping: SearchableSelect ← `shared/searchable-select.tsx`; DocNumberInput ← `shared/doc-number-input.tsx`; LineItemPicker ← `shared/line-item-picker.tsx`; FileField ← `shared/qc-report-attach.tsx`, `items/drawing-upload-field.tsx`, `items/item-image-field.tsx`; ItemBadge ← `shared/item-badge.tsx`; SortHeader ← `shared/sortable-th.tsx` / `sortable-head.tsx`; RelatedDocs + Timeline(compact) ← `shared/related-docs-tabs.tsx` / `related-docs-panel.tsx`; Timeline(rail) ← `so-timeline/timeline-body.tsx`; MachineCard ← `op-entry/machine-card.tsx`; KpiTiles ← `plans/planning-kpi-strip.tsx`; TabStrip + FilterBar ← `tasks/board-filters.tsx`; ConfirmDialog ← `lib/exit-guard.tsx`; Banner ← `job-cards/jc-recovery-banner.tsx` + login status; FilePreview ← `shared/file-preview-modal.tsx`; PrintDocument ← `lib/print/doc-print.ts`; StatusBadge ← every `*-status-badge.tsx` (SO, JC, JC-op, PR, PO, Production Order, GRN QC, DC, NC, NC disposition, store txn, related-doc generic).

**Intentional additions:** `Icon` (inlined Lucide glyph set so controls share one icon source), `SearchInput` (one search box), `StatusBadge` (one component for the per-module badge files), `FormGrid` (12-column `.form-grid-12`; `cols` = legacy equal columns), `CheckField` (native checkbox/radio with the blue accent — the app uses raw inputs), `FileField` (merges three upload fields). **Not built:** MachineSplit (planned/actual machine text), GlobalSearch popup results, SearchPopup, AssignTaskModal, the report Builder — read them in the repo if needed. The legacy left sidebar (`.sb-*`) was removed from the product on 2026-09-21 and is intentionally not included.

### Type, spacing and sizing rules (enforced everywhere)
- **Type scale — 5 sizes only:** 11 `--fs-xs` (labels, headers, badges, meta) · 13 `--fs-sm` (body, controls, cells, buttons, nav) · 16 `--fs-md` (panel/modal titles) · 22 `--fs-lg` (page title) · 28 `--fs-xl` (stat values). No other font-size; screens never override a component's size.
- **Spacing — 4px scale:** `--sp-0…6` = 2/4/8/12/16/24/32. 2px only for badges and compact/editable table cells. Page gutter 16, panel stack 8, panel 8×12 / 12, table cell 4×8.
- **Control height:** buttons, inputs, selects and search share `--control-h` 28px (sm 24px).
- **Field width:** forms use the 12-column `FormGrid`; `FormField size` by content — xs %/rev/days/UOM · sm qty/rate/date/doc no. · md select/ref/code · lg party/name/email · full remarks. Off-grid inputs (table cells, toolbars) use `.fw-xs/sm/md/lg` (64/104/144/224) — no inline pixel widths.
- **Header data (detail pages):** `ReadGrid` is the same 12-col grid; `ReadField size` = the size that field has in its edit form, so it sits in the same slot. Values 13/600, `mono` for codes/dates/qty, never truncated, empty "—". Every grid row sums to 12.
- **Textarea:** always size full, 2 rows min, resize vertical, max 240px.
- Print documents (`print.css`) keep their own pt scale for A4 output.

### Uniformity rule — one canonical implementation per element
Every element type has exactly ONE component; screens compose them and never re-implement. See the **Canonical elements** card (`guidelines/consistency.html`) for the divergences found in the source and their resolution. Summary:
- List page = ListHeader → (StatStrip **or** StatusPills) → DataTable/sheet **or** DocCard list → ListFooter. Detail page = DetailHeader(+ReadGrid) → Panels → RelatedDocs(+Timeline). Create/Edit page = section-hdr + Save/Cancel → Panel(FormGrid) → Panel(line table) → ConfirmDialog exit guard.
- Actions: RowActions everywhere (View · Edit · extra · Delete). Delete always goes through ConfirmDialog — never `window.confirm` or inline "Delete? Confirm".
- States: PageState only. Notices: Banner only. Modals: Modal / ConfirmDialog / FilePreview only (navy 45% overlay).
- Required marker is ★ everywhere. Colours are tokens only (no raw hex; the Plans `#8b5cf6` and timeline greys are normalised).
- Status colours come only from StatusBadge maps; qty colours only from the qty rules below.
- One component per family, no parallel looks: counts → StatStrip (StatCard/KpiTiles are aliases) · in-page tabs → TabStrip look · history → Timeline (density regular/compact) · label/value → ReadField (Fact is an alias) · square chips → Tag · every status/rating/active/priority → StatusBadge / PriorityText · search → SearchInput · page titles → `.section-hdr` · card radius → 8px.
- Control icons are Lucide via `Icon` (inlined, no runtime); emoji are only for module/page identity (nav, tabs, section titles, dashboard rows).
- The `.pof-*` compact PO palette is legacy; Create/Edit PO is built on the standard form.

### Field & table rules (minute-level)
- **Every field** = `.form-grp` (4px gap) → 11px mono uppercase `.form-label` (★ or * in `--red2` for required) → control → 11px `.form-help` (`--text3`) or `.form-error` (`--red2`).
- **Controls**: 13px Barlow, 7px 10px padding, 1px `--border`, 6px radius, white; focus = blue border + 3px `--focus-ring`; read-only 60% opacity; disabled 50% + `--bg3`; auto-derived = `--bg4` bg + `--text3`; valid = green border, invalid = red border. Numbers/qty use mono. Dates are native `type="date"` (ISO). Files: native `type="file"` for drawings, 📎 chip for optional attachments, 96px preview box for images.
- **Master/document pickers** are always SearchableSelect ("CODE — Name"); item codes in line editors use LineItemPicker (datalist); document numbers use DocNumberInput.
- **Tables — ONE design**: every table (list, register, nested lines, line editor, routing) is the ruled sheet `.innovic-table.tbl-grid` via DataTable. Differences are modifiers only: `.tbl-frozen` (pin first column), `.tbl-auto` (auto widths + side-scroll), `.tbl-compact` (nested lines), `.tbl-edit` (inputs in cells). The old unruled `.innovic-table` list look is legacy (why they differed: list = original legacy port, sheet = the 2026-09 standard SO/Vendors/JC/Plans migrated to, frozen/routing were bolted onto the old look). Header Barlow Condensed 800 11px uppercase `--blue2` on `--bg4`, sticky; 2px `--blue2` rules; 1px `--border2` gridlines; cells 13px, 8px, centred (names left, money right); cream/white rows; hover `--bg4`; short values never wrap; long text ellipsizes with `title`; row click opens detail with `cursor:pointer`; in-row controls `stopPropagation`; 💡 hint line under the table; count line bottom-right ("Showing all N …"). Codes: `.td-code` mono 12/600 (blue in sheets, purple for item codes/CPO lines). Qty: mono 700; Dispatched green, Balance red (✅ Done at 0), JC qty green/amber/muted by coverage. Overdue dates red + ⚠.
- **Lists that scroll vs page**: document & master lists scroll in one fetch; unbounded registers (GRN, DC, op log, store txns, activity) keep Prev/Next with `page` in the URL.

---

## CONTENT FUNDAMENTALS
- **Voice:** operational, plain, shop-floor English. Short labels named after the paper document: *SO Master, JWSO Master, GRN (Goods Receipt), Job Cards, NC Register, OSP Outward DC*. Heavy, unexplained acronyms are normal (SO, WO, JC, PR, PO, GRN, DC, NC, CAPA, TPI, BOM, OSP, CPO).
- **Casing:** Title Case for page/menu names and buttons ("Create Production Order", "Expand all" is the exception — sentence-ish for secondary toggles). UPPERCASE mono for table headers, form labels, stat labels and badges (applied by CSS, source text is normal case).
- **Person:** addresses the user as *you* in helper copy ("You're all caught up — no pending work.", "This page is hidden for your access. Ask an admin…"); greeting uses first name: "Good Morning, Vinay".
- **Action copy:** verb-first with symbols — "+ New SO / WO", "+ Line", "Del", "Dispose →", "View →", "Open full detail →". Arrows (→ ›) signal navigation.
- **Empty/state copy:** direct and instructive — "No orders — click + New SO/WO", "✅ All clear — nothing needs attention.", "Showing all 23 sales orders", "Showing first 1000 of 1240 — refine with search".
- **Hints:** a 💡 line under tables explains interaction: "💡 Click a row to open its detail page · click ▸ before the SO number to show its line items".
- **Separators:** middle dot " · " between metadata ("2026-09-18 · PO 4500087121 · Vinay K. · Due 2026-09-30").
- **Emoji:** yes — used as menu/page icons (📋 🏭 🚚 📥 🔬 ⚙), status glyphs (✅ ⚠ 🔴) and button prefixes (🔔 Alerts, 📦 Widgets). Inherited from the legacy app; keep to the existing set.
- **Numbers & dates:** ISO dates `2026-09-23`, codes like `IN-SO-26-0142`, `CODE/REV` for items, quantities in mono, "pcs" for pieces, ₹ for money.

## VISUAL FOUNDATIONS
- **Overall vibe:** dense, flat, light, industrial. White/light-grey surfaces, ONE Innovic blue (`#155eef`) for every interactive emphasis, subtle cool borders, compact controls. Built for 1366px office screens and shop-floor monitors. Light-only (dark mode explicitly unsupported).
- **Colour:** navy text `#172b4d` in three weights; five surface steps (`--bg`…`--bg5`); every accent has solid (fills only) / `2` dark (text + solid buttons) / `3` pale wash (badges, active states). Signal colours (`--sig-*`) are reserved for actionable meaning. Department tints identify modules. No gradients (removed in the 2026-09 theme).
- **Type:** Barlow Condensed (headings, panel titles, big numbers), Barlow (body 14 / controls 13), Source Code Pro (codes, IDs, labels, table headers, quantities). 11px is the floor. Uppercase + letter-spacing 0.04–0.1em for mono labels.
- **Spacing/density:** 20px page gutter, panel header 8×14, panel body 12, table cells 6×10, buttons 7×12 (~32px tall, same as inputs), 10px between stacked panels. Never "airier".
- **Backgrounds:** flat colour only. No imagery, textures, patterns or illustrations. Item thumbnails are the only photos (product/part images).
- **Corners:** 4px chips/badges, 6px buttons/inputs/tabs, 8px panels/cards/modals, 10px dropdown menus; pills (999px) only for status-filter chips; avatars round.
- **Cards/panels:** white, 1px `--border`, 8px radius, **no shadow**, `--bg3` header band with Barlow Condensed title. SO cards add a 4px left accent bar (blue open / red late / green done). Legacy stat cards use a 2px top stripe.
- **Borders:** 1px hairlines everywhere; one hairline closes the header chrome. Ruled "sheet" tables use 2px `--blue2` top/bottom rules, vertical gridlines and cream (`#fffbf2`) / white alternating rows.
- **Shadows:** only floating layers — menus (`--shadow-drawer`), toasts, modals (`0 8px 24px rgba(23,43,77,.12)`).
- **Transparency/blur:** only the modal overlay — navy 45% + `backdrop-filter: blur(2px)`.
- **Hover:** fill to `--bg3`/`--bg4` (rows, nav, ghost buttons); solid buttons darken to the `2` tone; table headers turn blue; clickable dashboard surfaces also get a blue border.
- **Active/selected:** blue wash `--blue3` + blue text (nav items, menu links); page tab gets a 2px blue top edge; StatStrip filter gets a 2px bottom border in its colour. Disabled = 50% opacity.
- **Press:** no shrink/scale; colour change only.
- **Focus:** 3px `rgba(21,94,239,.15)` ring + blue border on inputs; 2px blue outline offset 2px on links.
- **Animation:** minimal — 0.15s `all` transitions on hover, toasts slide in 20px over 0.2s ease, progress bars 0.4s ease. Only looping animation: overdue QC row blink. Respects reduced-motion.
- **Layout:** fixed 54px header band (logo · Dashboard · module dropdowns · search · sync · password · sign-out · avatar), open-page tab strip, breadcrumb, then one scrolling content area. List pages pin their toolbar band (`position: sticky; top: 0; background: var(--bg)`). All table columns centred; short values never wrap; long text ellipsizes with a title tooltip. Counts above lists are ONE StatStrip, never separate cards.

## ICONOGRAPHY
- **Two systems coexist:**
  1. **Emoji / Unicode glyphs** — the legacy icon language. Every nav item, open-page tab and dashboard row has an emoji (`nav-sections.ts`: 📋 SO Master, 🔧 JWSO, 🚚 Dispatch, 🏢 Client, 📥 GRN, ◉ Item Master, 🏭 Production, ✚ Op Entry, ▭ Job Cards, ⚙ Machines, 👷 Operators, 🔬 QC, ⚠️ NC, 🗑 Trash…). Unicode is also used for UI marks: ▾ caret, › breadcrumb separator, × close, → next, ☰ List View, ▦ Card View, ▸ expand.
  2. **Lucide** (`lucide-react`, shadcn `iconLibrary: lucide`) — for control icons: KeyRound, LogOut, ChevronDown/Right, Download, Loader2, Eye, Pencil, Trash2, Mail, CheckCircle2. Sizes 12–15px, default 2px stroke. The UI kit loads Lucide from CDN (`lucide@0.468.0`), the same set the product uses.
- No icon font, no SVG sprite, no custom illustrations in the repo.
- Rule of thumb: page/module identity → emoji; control affordance (row actions, header buttons, chevrons) → Lucide. Icon-only buttons always carry a `title`.

## Brand
- Logo: `assets/innovic-logo.jpeg` (JPEG on white, italic "INNOVIC" with a blue parallelogram). Shown 24px tall in the header. No SVG / transparent version exists in the repo.
- Fonts load from Google Fonts (`tokens/fonts.css`) — the product does the same; no font binaries are in the repo.
