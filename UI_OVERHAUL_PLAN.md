# Innovic ERP — UI Overhaul Plan

Branch `ui-overhaul` · worktree `wt-ui-overhaul` · forked from `test` @ `227b1903`
Rollback tag `pre-ui-overhaul-20260923` (pushed)
Design reference: `design-ref/` (210 files, 3.1 MB — the Claude Design export, committed to this branch)

Backing detail lives in `audit/`:

| File | What it holds |
|---|---|
| `audit/00-baseline.md` | Green baseline + bundle sizes before any change |
| `audit/01-foundation-delta.md` | Exhaustive token table + class-by-class CSS diff (715 lines) |
| `audit/02-element-inventory.md` | 44 design components → app components (355 lines) |
| `audit/03-screen-inventory.md` | All 138 screens classified (367 lines) |
| `audit/04-violations-risks.md` | Violation census with reproducible commands (664 lines) |

---

## 0. The single most important finding

**This design system was generated from this app.** `design-ref/tokens/colors.css` says so in its
first line, and the colours are byte-identical to `apps/web/src/styles/tokens.css`. The reference
reuses the app's own class vocabulary verbatim — `.panel`, `.btn`, `.innovic-input`,
`.innovic-table`, `.tn-*`, `.form-grp`, `.badge`.

So this is **not** a redesign. It is a **normalisation**: the design system picked one winner for
every element where the app currently has two or three, and tightened the scale. That changes the
character of the work:

- Phase 2 (foundation) is small — an additive CSS merge, not a rewrite.
- Phase 4 (screens) is large — 138 screens have to stop re-implementing things inline.

The risk is therefore **not** "will it look wrong", it is **"will 138 screens still behave"**.

---

## a) Design token extraction

Full table in `audit/01-foundation-delta.md` §1. What actually changes:

### Colour — zero change
Every colour token is byte-identical. Surfaces, borders, text, all 8 accent families with their
`/2`/`3` tiers, 10 department tints, 5 signal trios. Nothing to do.

Two additions:

| Token | Value | Why |
|---|---|---|
| `--sheet-cream` | `#fffbf2` | Currently hard-coded at `innovic-theme.css:847` — the only genuine "should be a token" hex in the stylesheet |
| `--surface-*`, `--text-*`, `--accent-*`, `--border-*` | aliases | Semantic layer over the raw tokens; optional, no visual effect |

### Typography — CHANGED (visible app-wide)

The reference enforces exactly five sizes and forbids every other value.

| Role alias | Now | Reference | Effect |
|---|---|---|---|
| `--fs-body` | 14px | **13px** | Every body cell, label and paragraph shrinks 1px |
| `--fs-heading` | 17px | **16px** | Panel + modal titles |
| `--fs-control` | 13px | 13px | — |
| `--fs-label` / `--fs-mono` | 11px | 11px | — |
| `--fs-section` | 22px | 22px | — |
| `--fs-stat` | 28px | 28px | — |

New named scale: `--fs-xs` 11 · `--fs-sm` 13 · `--fs-md` 16 · `--fs-lg` 22 · `--fs-xl` 28.

`innovic-theme.css` itself currently breaks this rule in 13 places (9, 10, 12, 12.5, 14, 20, 36px —
lines 151, 168, 201, 261, 308, 350, 502, 532, 554, 883, 1277, 1361, 1519).

### Spacing, sizing, motion — ENTIRELY NEW token families

The app has **none** of these today; sizes are expressed as ad-hoc padding.

| Family | Values |
|---|---|
| `--sp-0…6` | 2 / 4 / 8 / 12 / 16 / 24 / 32 |
| `--control-h`, `--control-h-sm` | **28px**, 24px |
| `--field-xs/sm/md/lg` | 64 / 104 / 144 / 224 |
| `--radius-menu` | 10px (joins the existing 4 / 6 / 8) |
| `--content-pad`, `--panel-gap` | 16px, 8px |
| `--ease-fast` | 0.15s |

**Control height is a real change.** Buttons and inputs have no explicit height today — they are
sized by padding to roughly 32px. The reference pins them to 28px so every control in a row aligns.

### Layout

| Token | Now | Reference |
|---|---|---|
| `--topbar-height` | 54px | **48px** |
| page gutter | 20px (hard-coded) | **16px** (`--content-pad`) |
| `--sidebar-width` | 220px | 220px — **dead**, sidebar was removed 2026-09-21 |

### Effects / motion — no change
`--focus-ring`, `--overlay-bg`, `--shadow-modal/toast/drawer` are identical. Panels carry no shadow
in both. Transitions 0.15s in both.

---

## b) Element inventory

Full table in `audit/02-element-inventory.md` §A. 44 reference components. Summary by action:

| Action | Count | Meaning |
|---|---|---|
| **CONSOLIDATE** | 19 | N inline re-implementations collapse into 1 component |
| **REBUILD** | 14 | A real component exists; restructure + reskin it |
| **NEW** | 11 | No equivalent exists at all |

### The consolidation wins, by blast radius

| Component | Sites collapsing into it |
|---|---|
| `PageState` (loading/error/empty/no-access) | 206 loading + 61 no-access sites |
| `EmptyState` | 194 sites (539 `.empty-state` usages across 204 files) |
| `Panel` | 180 sites |
| `DataTable` | 131 files render `.innovic-table` |
| `ListHeader` | ~97 list screens |
| `SearchInput` | **138 screens, 0 shared** — every list hand-rolls its own `<input>` |
| `StatusBadge` | 10 dedicated `*-status-badge.tsx` files |

### Genuinely new — has to be authored from nothing

`FormField` + `FormGrid` (the 12-column `.form-grid-12` does not exist in the app today — 0% adoption),
`CheckField`, `Modal`, `ConfirmDialog`, `Toast`/`ToastStack` (CSS exists, no React usage at all),
`Skeleton`, `Icon` (one inlined Lucide source), `Tag`, `SyncDot`, `DocCard`, `KpiTiles`.

### Real inconsistency found, not just duplication

`so-status-detail.tsx` defines a **local `JcStatusBadge` that shadows the canonical one** in
`jc-status-badge.tsx` — and gives `complete` a *different colour* (green vs cyan). The same job-card
status is two colours depending on which screen you're on. Consolidation fixes a genuine bug, and
the user needs to say which colour is correct.

---

## c) Layout shell diff

| Region | Now | Reference | Action |
|---|---|---|---|
| Top bar | 54px, `#topnav`, `.tn-*` | 48px, same `.tn-*` vocabulary | Reskin, change height |
| Open-page tabs | `id="pagetabs"` | `.pagetabs` **class** | ⚠ selector mismatch — see risks |
| Breadcrumbs | `id="breadcrumbs"` | `.breadcrumbs` **class** | ⚠ selector mismatch |
| Left sidebar | already removed (2026-09-21) | not present | Delete the dead `.sb-*` CSS |
| Content area | 20px gutter, one scroll region | 16px gutter, same | Retune gutter |
| Sticky list toolbar | ad-hoc per screen | `position:sticky;top:0` standard | Fold into `ListHeader` |
| `--sidebar-width`, `#topbar`, `.tb-*`, `.innovic-body`, `#toast` | dead CSS, 0 TSX matches | absent | Delete |

---

## d) Screen inventory — 138 screens

Full per-route table in `audit/03-screen-inventory.md` §A. All 138 route files are registered in
`router.tsx`; none are orphaned. (Plus 7 shell/auth routes outside `modules/`.)

| Pattern | Count | Template to build |
|---|---|---|
| LIST | 41 | ListHeader → StatStrip\|StatusPills → DataTable → ListFooter |
| FORM | 37 | section-hdr + Save/Cancel → Panel(FormGrid) → Panel(line table) → exit guard |
| DETAIL | 26 | DetailHeader(+ReadGrid) → Panels → RelatedDocs(+Timeline) |
| OTHER | 12 | bespoke — no canonical pattern fits |
| REPORT/PRINT | 10 | **out of scope, see §e** |
| DASHBOARD | 7 | WorkList / KpiTiles / QuickLinks |
| SETTINGS/ADMIN | 5 | Panel + FormGrid |

Current state of those screens:

- **14** use the canonical ruled sheet `.innovic-table.tbl-grid`; **~114** still use the legacy plain
  `.innovic-table`; ~14 abandoned tables for cards/shadcn entirely.
- **14** use the shared `StatStrip`. **0** use a shared search input.
- **7** use `.tbl-frozen` (pinned first column) — CSS hand-fitted to the old markup, highest-risk table work.

---

## e) Gaps

### In the design, absent from the app
`FormGrid`/`FormField` (12-col), `CheckField`, `ConfirmDialog`, `Toast`, `PageState`, `Skeleton`,
`DocCard`, `KpiTiles`, `SyncDot`, `Tag`, `Icon`. All greenfield authoring in Phase 2.

### In the app, absent from the design — proposed treatment

| App-only | Proposed treatment |
|---|---|
| MachineSplit (planned vs actual machine) | Two `ReadField`s in one grid cell |
| GlobalSearch popup + results | Style as `.ss-list` dropdown, reuse Modal overlay tokens |
| AssignTaskModal | Standard `Modal` + `FormGrid` |
| Report Builder (`print-templates/editor.tsx`) | **Leave alone** — WYSIWYG block editor, 101 raw hex are its palette, not violations |
| Production Schedule Gantt | Bespoke; adopt tokens only |
| Design Task Kanban | Bespoke; adopt tokens + `Tag` |
| `error-boundary.tsx` | Fold into `PageState` error variant |
| `.tn-sync` (header sync status) | Live in `top-nav.tsx`, absent from reference CSS — must be preserved |
| `jc-row-acts` (Job Card row actions) | Replace with `RowActions` |

### ⚠ Where the design reference is WRONG and must not be followed

1. **Print.** `design-ref/tokens/print.css` and `PrintDocument.prompt.md` specify *Arial, greyscale,
   12px*. This app's **final, approved** print standard is the Innovic Sheet —
   `apps/web/src/lib/print/sheet-print.ts`, **Times New Roman, one table**. The reference is stale
   here. **All 10 REPORT/PRINT screens and everything under `lib/print/` are excluded from this
   overhaul.** No print output changes.

2. **README self-contradiction.** The "enforced rules" block says 16px gutter / 28px controls / 13px
   body; the older "Visual Foundations" prose in the same file says 20px gutter / ~32px buttons /
   14px body. The machine-readable `tokens/*.css` agrees with the enforced block, so I follow that —
   but it means the density change in §a is deliberate, not accidental.

3. **`.pof-*` compact PO palette.** The reference itself marks it legacy. Create/Edit PO moves to the
   standard form; `po-compact.css` is not adopted.

---

## f) Risks

| # | Risk | Why | Mitigation |
|---|---|---|---|
| 1 | **CSS selector mismatch** | App uses `id="breadcrumbs"` / `id="pagetabs"`; reference styles `.breadcrumbs` / `.pagetabs`. A wholesale swap silently unstyles the entire header chrome. | **Do not replace `innovic-theme.css` wholesale.** Merge additively; fix these two selectors first. |
| 2 | **`searchable-select.tsx`** | Imported by 36 files. Tailwind-only, off-ladder z-index, `document.body` portal + capture-phase listeners. | Reskin the markup only; do not touch state, keyboard or portal logic. Dedicated verification pass. |
| 3 | **Dependent-field cascades** | Live inside the worst-offending form files (`bom-form.tsx`, `sales-order-form.tsx`, `job-work-order-form.tsx`). | Migrate layout only. `use-field-cascade.ts` untouched. Manual test per cascade form. |
| 4 | **Frozen/sticky tables** | 7 files; `.tbl-frozen` CSS hand-fitted to old markup. | Migrate last, one at a time, with before/after screenshots. |
| 5 | **Permission gating** | `requireFormAccess` is API-side; frontend gating is 46 files of ad-hoc hooks with no shared pattern. | Inventory denied-states manually **before** moving anything to `PageState state="noaccess"`. |
| 6 | **491–539 `.empty-state` usages** serve loading, empty, error *and* no-access with no differentiation | Largest blast radius; no codemod path. | Classify by hand, per screen, during its group's migration. |
| 7 | **Density change (14→13px, 32→28px)** | Affects every screen at once. Cannot be reviewed screen-by-screen after the fact. | Land it alone in Phase 2, review at `/__ui-kit` + 3 real screens before proceeding. |
| 8 | **114 legacy tables → ruled sheet** | Biggest single visual change in the project. | One group at a time; representative screen first at Checkpoint 4. |
| 9 | **26 hand-rolled modals, 50/67 off-ladder inline z-index** | No shared Modal exists; overlays stack unpredictably. | Build `Modal` first in Phase 2, migrate modals as their screen migrates. |
| 10 | **Stale Tailwind palette** | `tailwind.config.ts` carries the *pre-2026-09* theme (`innovic.cyan #0088bb` vs real `#155eef`) — a third, wrong source of truth. Used by only 2 files. | Convert those 2 files, then delete the `innovic.*` / `dept.*` / `sig.*` namespaces. |

### Violation census (the Phase 4 workload)

| Rule | Violations | Files | Codemod? |
|---|---|---|---|
| Raw hex / rgba | 612 | 120 | Partly |
| Inline pixel widths | 413 | 141 | Partly |
| Off-scale font sizes | 1,575 / 2,671 | 243 | Partly |
| Off-scale spacing | 1,758 / 3,565 | 269 | Partly |
| `window.confirm` / `alert` / `prompt` | 64 | 42 | No |
| Legacy table look | 114 files | 114 | No |
| Hand-rolled modals | 26 | 26 | No |
| Emoji as control icon | 33 | — | Partly |
| Required marker `*` → `★` | 17 | — | Yes |

Already healthy: 91% of buttons use `.btn`, 82% of inputs use `.innovic-input`, `★` already dominates
(224 uses), 234 files already use Lucide.

---

## Phase plan

| Phase | Scope | Gate |
|---|---|---|
| 0 ✅ | Branch, tag, worktree, baseline, design-ref committed | done |
| 1 ✅ | This audit | **CHECKPOINT 1 — you are here** |
| 2 | Tokens + primitives + `/__ui-kit` route | CHECKPOINT 2 |
| 3 | Shell (top bar, tabs, breadcrumbs, page header) | CHECKPOINT 3 |
| 4 | Screens, one representative first, then group by group | CHECKPOINT 4, then per-group |
| 5 | Preview deploy on TEST API/Supabase | CHECKPOINT 5 |
| 6 | Keep in sync — merge `test` INTO `ui-overhaul`, never the reverse | ongoing |

### Proposed Phase 4 group order (cheapest → riskiest)

1. Masters already on the sheet look (S) — rep: Vendors
2. Thin-wrapper FORM screens (S) — rep: QC Process new/edit
3. LIST screens on the legacy table, no frozen columns (M) — rep: Purchase Orders
4. DETAIL screens (M) — rep: Job Card detail
5. SETTINGS/ADMIN (S)
6. DASHBOARD (M)
7. FORM screens with cascades (L) — rep: Sales Order form
8. Frozen/sticky tables (L) — 7 files, one at a time
9. OTHER / bespoke (L) — `design-projects/detail` (2,127 LOC), `so-planning/workflow` (1,583 LOC)
10. REPORT/PRINT — **excluded**

---

## Decisions I need from you at Checkpoint 1

1. **Density.** Body text 14→13px and controls ~32→28px, everywhere. This is the reference's
   explicit rule and it will look noticeably tighter on every screen. Confirm, or keep 14/32?
2. **Page gutter** 20→16px — same question, and the reference contradicts itself here.
3. **Top bar** 54→48px?
4. **All 114 legacy tables become ruled sheets.** Confirm this is what you want everywhere, or should
   some registers keep the plain look?
5. **`JcStatusBadge` colour conflict** — `complete` is green on the SO Status screen and cyan on the
   Job Card screen. Which is correct?
6. **Print is excluded** — confirm you agree, given the reference contradicts your own final Innovic
   Sheet standard.
7. **Scope.** 138 screens at element level is a long job. Do you want all 138, or should I stop after
   the high-traffic groups (1–6) and leave the bespoke giants alone?

No API, schema, Zod or business-logic change is needed for anything in this plan. No screen was found
that needs data the API does not already provide.

---

## Progress checklist

- [x] Phase 0 — branch, tag, worktree, baseline green, design-ref in branch
- [x] Phase 1 — audit + this plan
- [ ] Phase 2 — tokens + primitives + `/__ui-kit`
- [ ] Phase 3 — shell
- [ ] Phase 4 — screens (0 / 128 in scope)
- [ ] Phase 5 — preview deploy
