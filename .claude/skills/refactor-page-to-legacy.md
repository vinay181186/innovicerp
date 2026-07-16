---
name: refactor-page-to-legacy
description: Refactor a single React page in apps/web to match the legacy HTML's rendering exactly. Use when the user says "refactor <route> to legacy", "fix <module> page UI", or "match <page> to HTML". Works on ONE page at a time — never batches multiple pages.
---

# Refactor Page to Legacy

## When this skill activates

User says any of:
- "refactor /items to legacy"
- "fix /sales-orders UI"
- "match items list to HTML"
- "make <route> look like legacy"
- "redo <module> page"

## Critical rule: ONE PAGE AT A TIME

If the user asks for multiple pages, refactor the FIRST one only, then ask
which to do next. Never batch.

## Inputs to extract from user message

- **Route path** — e.g., `/items`, `/sales-orders`, `/items/new`
- **Module name** — derived from route: `items`, `sales-orders`
- **Page type** — list / detail / new / edit / form (default = list if not specified)
- **Target file** — derived: `apps/web/src/modules/<module>/routes/<type>.tsx`
  (or `components/<X>-form.tsx` for forms)

## Required reading (ALWAYS in this order before any change)

1. `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` — find the
   matching `render<Name>()` function. This is the source of truth.
2. `apps/web/src/styles/innovic-theme.css` — confirm CSS class names exist
3. `apps/web/src/styles/tokens.css` — confirm tokens
4. `apps/web/src/modules/bom-master/routes/list.tsx` — gold-standard reference
5. `apps/web/src/modules/route-cards/routes/list.tsx` — second reference
6. `docs/STYLE_GUIDE.md` — pattern documentation
7. The current target file

If ANY of files 1-3 don't exist, STOP and report the missing file to user.

## Search patterns for legacy HTML

| Route | Search pattern |
|---|---|
| `/items` | `function renderItems(` |
| `/clients` | `function renderClients(` |
| `/vendors` | `function renderVendors(` |
| `/machines` | `function renderMachines(` |
| `/operators` | `function renderOperators(` |
| `/job-work-orders` | `function renderJW(` or `renderJobWork(` |
| `/purchase-requests` | `function renderPR(` |
| `/purchase-orders` | `function renderPO(` |
| `/goods-receipt-notes` | `function renderGRN(` |
| `/sales-orders` | `function renderSO(` or `renderSalesOrders(` |
| `/nc-register` | `function renderNC(` |
| `/delivery-challans` | `function renderDC(` |
| `/job-cards` | `function renderJC(` |
| `/op-entry` | `function renderOpEntry(` |
| `/route-cards` | `function renderRouteCards(` |
| `/bom-masters` | `function renderBOM(` |

Read the entire function body. If multiple matching functions exist, list them
to the user and ask which one to follow.

## Before you use ANY class name — including one from this document

**Grep `apps/web/src/styles/` first. This document has been wrong NINE times.** It prescribed
nine classes that exist in neither legacy nor our theme: `form-label-required`, `filter-bar`,
`section-title`, `section-actions`, `panel-meta`, `empty-state-icon`, `empty-state-msg`,
`page-wrap`, `btn-outline`. Agents following the examples shipped inert markup that
typechecked, linted, and read correctly in review. **All nine are corrected below — but that
is exactly what this document said before each of the last eight were found.** Treat every
example here as a hint, not an authority. Grep, then use.

**The real vocabulary** (grep-verified, `innovic-theme.css`):
- **Buttons:** `.btn` · `.btn-sm` · `.btn-primary` · `.btn-ghost` · `.btn-danger` · `.btn-success` · `.btn-icon`. **No `.btn-outline`.**
- **Panels:** `.panel` · `.panel-hdr` · `.panel-title` · `.panel-body`. **No `.panel-meta`.**
- **Tiles:** `.stat-grid` · `.stat-card` (+ `.cyan`/`.amber`/`.green`/`.red` only) · `.stat-label` · `.stat-val` · `.stat-sub`. **No `.stat-card.blue`, no `.dash-stat-card`.**
- **Tables:** `.innovic-table` · `.tbl-wrap` · `.tbl-frozen` · `.td-code` · `.td-ctr` · `.td-right` · `.empty-state` · `.empty-icon`.
- **Text:** `.mono` · `.fw-700` · `.text2` · `.text3` · bare `.cyan`/`.amber`/`.green`/`.red`. **No `.fw-600`, no `.fw-800`** — legacy uses inline `font-weight`, mirror that.
- **Forms:** `.form-grid` · `.form-grid-3` · `.form-grp` · `.form-full` · `.form-label` · `.req` (the ★) · `.form-error` · `.innovic-input` · `.innovic-select` · `.innovic-textarea`. **No `.form-input`.**
- **Badges:** `.badge` + `.b-green`/`.b-amber`/`.b-blue`/`.b-red`/`.b-grey`/`.b-cyan`/`.b-orange`/`.b-teal`. **No `.b-purple`, no `.b-running`, no `.b-yellow`.**
- **Misc real:** `.tag` · `.prog-wrap` · `.prog-bar` · `.overlay` · `.modal`/`.modal-lg`/`.modal-hdr`/`.modal-title`/`.modal-body`/`.modal-footer` · `.task-unread` · `.task-linked-ref`.
- **Absent, do not use:** `.page-wrap` · `.mt-16` · `.mach-id` · `.mach-card` · `.op-node` · `.op-arrow` · `.rpt-total` · `.pt-vars-panel` · `.pt-var-chip` · `--teal` · `--text1`.

Two checks decide any class question:

1. **Does OUR theme define it?** `grep -n "\.classname[ ,{:]" apps/web/src/styles/innovic-theme.css`
2. **Does LEGACY define it, and in WHICH `<style>` block?** Legacy's main stylesheet opens at
   **L10**; a second, **print-only** block opens at **L10539**. A class defined only in the
   print block does nothing in legacy's app.

Neither direction can be assumed:
- *Legacy uses X* does NOT mean *legacy defines X* — legacy writes `stat-card blue` (L23608,
  L25336, L26487) but defines only cyan/amber/green/red (L97-102). Those tiles render with no
  accent **in legacy**, so matching legacy means adding no rule.
- *Legacy defines X* does NOT mean *X applies* — `.b-running` (L10561) is print-block only, so
  legacy's own `Running` badge is unstyled on screen.
- **Grep patterns lie too.** `.tbl-frozen` looked undefined because legacy declares it as
  descendant selectors (`.tbl-frozen tbody td:first-child, ...`, L119-122), not a bare rule.
  It was real and is now ported.

**Settled cases:** `.tbl-frozen` ✅ ported · `.tag` ✅ ported (square mono chip, ≠ pill `.badge`)
· `.fw-600` ❌ never existed (legacy uses inline `font-weight:600`) · `.stat-card.blue` ❌ don't
add · `.b-running` ❌ don't port · `.b-purple` ❌ absent (only the `--purple` token exists)
· `.row-actions*` — real in legacy (L148-152) but NOT ported: it's a kebab dropdown needing
state + outside-click handling, i.e. a component port. Report, don't approximate.

**A class can be spelled plausibly, typecheck, lint, and do nothing.** Nothing in the
toolchain catches it. Only grep does.

## Transformations to apply

### Outer wrapper

Legacy's `render*()` functions return a **bare `<div>`** with no wrapper class. There is no
`.page-wrap` — it exists in no stylesheet and appears **zero times in legacy**. (It was
prescribed here and no page ever adopted it, because agents grep first. Keep it that way.)

```tsx
// FROM:
<main className="container max-w-6xl py-10">

// TO:
<div>
```

### Page header

`.section-hdr` is a FONT rule (font-family/size/weight/margin), **not** a flex container —
legacy L273, ported at `innovic-theme.css`. Legacy wraps it in an inline-styled flex row.
There is **no `.section-title` and no `.section-actions`** in legacy or in our theme.

```tsx
// FROM:
<div className="flex items-start justify-between">
  <h1 className="text-2xl font-semibold tracking-tight">Items</h1>
  <Button>+ New Item</Button>
</div>

// TO — the gold standard's actual shape (bom-master/routes/list.tsx:52):
<div className="mb-3 flex items-center justify-between gap-3">
  <div className="section-hdr m-0">📦 Item Master</div>
  <div className="flex items-center gap-2">
    <Link to="/items/new" className="btn btn-primary">+ Add Item</Link>
  </div>
</div>
```

### Filter bar

**There is no `.filter-bar`** — not in legacy, not in our theme. Legacy uses an
inline-styled flex row; mirror legacy's own inline styles.

```tsx
// TO:
<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
  <input type="text" className="innovic-input" placeholder="🔍 Search..." />
  <select className="innovic-select">...</select>
</div>
```

### Table panel
```tsx
// FROM:
<div className="rounded-md border bg-card">
  <Table>...</Table>
</div>

// TO — .panel/.panel-hdr/.panel-title/.panel-body exist; there is NO .panel-meta.
// Only add a panel-hdr if legacy has one; several legacy lists go straight to the table.
<div className="panel">
  <div className="panel-hdr">
    <div className="panel-title">All Items</div>
  </div>
  <div className="tbl-wrap">
    <table className="innovic-table">
      <thead><tr><th>Code</th>...</tr></thead>
      <tbody>{rows.map(row => (<tr>...</tr>))}</tbody>
    </table>
  </div>
</div>
```

Add `tbl-frozen` beside `tbl-wrap` — `<div className="tbl-wrap tbl-frozen">` — **only where
legacy does** (Job Cards L5784, SO L11970, PO L25349, GRN L26492, + L14319, L16085). It pins
the first column while the table scrolls sideways.

### Status badge
```tsx
// FROM:
<Badge variant="success">Closed</Badge>

// TO:
<span className="badge b-green">Closed</span>
```

Color mapping (use legacy HTML's actual usage if different):
- `b-green`: closed, completed, qc_passed, available, dispatched, qc_accepted
- `b-amber`: pending, in_progress, qc_pending, partial_dispatch, bom_pending
- `b-red`: on_hold, cancelled, qc_failed, rejected, qc_rejected, overdue
- `b-blue`: open, running, draft, sent, po_created

### Action buttons

**There is no `.btn-outline`.** The real set is exactly: `.btn`, `.btn-sm`, `.btn-primary`,
`.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-icon`. Row actions in this repo use
`btn btn-ghost btn-sm`; destructive ones use `btn btn-danger btn-sm`.

```tsx
// FROM:
<Button variant="outline" size="sm">Edit</Button>

// TO:
<Link to="..." className="btn btn-ghost btn-sm">Edit</Link>
```

### Empty state

`.empty-state` exists and goes **on the `<td>`**. There is no `.empty-state-icon` and no
`.empty-state-msg`. Use legacy's exact wording — it is usually a bare string.

```tsx
// FROM:
<TableEmpty>No items found</TableEmpty>

// TO:
<tr>
  <td colSpan={columns.length} className="empty-state">
    No items — click <strong>+ Add Item</strong>
  </td>
</tr>
```

### Form fields (if refactoring a form)
```tsx
// FROM:
<div className="grid gap-4">
  <div>
    <Label>Name</Label>
    <Input {...register('name')} />
  </div>
</div>

// TO:
<div className="form-grid">
  <div className="form-grp">
    <label className="form-label">
      Name<span className="req">★</span>
    </label>
    <input className="innovic-input" {...register('name')} />
    {errors.name && <div className="form-error">{errors.name.message}</div>}
  </div>
</div>
```

**The required marker is `<span className="req">★</span>` — red star, no space before it.**
Defined at `innovic-theme.css:566` as `.form-label .req` (so it only styles inside a
`.form-label`). This is the convention in `bom-master/components/bom-form.tsx:244` and
every other form in the repo.

> **This example previously prescribed `className="form-label-required"` with a `*`.
> That class is defined in NO stylesheet** — it rendered an unstyled marker instead of a
> red star, and this doc was the source that propagated it (still live at
> `qc-documents/routes/list.tsx:1233`). If you are ever unsure a class exists, grep
> `apps/web/src/styles/` before using it. A class name can look right, typecheck, and
> lint clean while doing absolutely nothing.

## Centring a column: use `meta.tdClass` — do NOT re-declare the augmentation

Legacy puts cell classes on the `<td>`. `flexRender` renders only the cell's inner
content, so a `td-ctr` written inside a `cell:` renderer lands on a `<span>` and does
nothing (ISSUE-020). Two accepted fixes:

1. **`meta.tdClass`** — keeps `useReactTable` (needed for expandable rows / `SortableHead`):
   ```tsx
   { header: 'Qty', accessorKey: 'qty', meta: { tdClass: 'td-ctr mono fw-700' },
     cell: ({ row }) => row.original.qty }
   // ...and in the body loop:
   <td key={cell.id} className={cell.column.columnDef.meta?.tdClass}>
     {flexRender(cell.column.columnDef.cell, cell.getContext())}
   </td>
   ```
   **The `ColumnMeta.tdClass` augmentation already exists — `apps/web/src/types/tanstack-table.d.ts`.
   Just use `meta`. Do NOT add `declare module '@tanstack/react-table'` to your page.**
   It is a global augmentation; four list pages each declared their own copy before that
   shared file existed, which only typechecked while all four stayed byte-identical.

2. **Plain `<tr>/<td>`** — drop `useReactTable`/`flexRender` per the `bom-master` gold
   standard (`vendors`, `machines`, `operators`, `cost-centers` did this). Simplest when the
   page has no expandable rows.

## SETTLED — do NOT re-raise these (each has already cost agent budget)

### `dateLike()` / `toISOString()` over raw `tx.execute` is SAFE. Two agents have flagged it. It is not a bug.

**The recurring claim:** *"raw `tx.execute` bypasses Drizzle's string mode, so node-postgres parses DATE into a local-midnight `Date`, and `toISOString().slice(0,10)` shifts it back a day on an IST host."*

**The driver is misidentified. We do not use node-postgres.**

- `apps/api/src/db/client.ts:1-2` → **`drizzle-orm/postgres-js` + `postgres`** = **postgres.js**
- postgres.js (`postgres@3.4.9/src/types.js:28-32`): `from: [1082,1114,1184]`, **`parse: x => new Date(x)`**
- **ECMA-262: a date-ONLY ISO form (`'2026-04-29'`) parses as UTC.** (Date-*time* forms without an offset parse as local — that is the distinction that makes this look wrong.)
- → UTC midnight → `toISOString().slice(0,10)` returns **the same date**

**Proven on a host at UTC+5:30 (IST), the exact failing condition:**
```
new Date('2026-04-29')     -> 2026-04-29T00:00:00.000Z
toISOString().slice(0,10)  -> 2026-04-29     SAFE
```
node-postgres genuinely *does* return local midnight for dates — the concern is right for that driver and wrong for ours. **If the driver ever changes, re-open this.**

**This does NOT weaken the so-timeline 500 (ISSUE-142)** — that bug is `Date.prototype.localeCompare` not existing, which is timezone-independent. Both sit on the same postgres.js `parse: x => new Date(x)`; one is fatal, one is harmless. **Check the driver's actual behaviour; never assume it in either direction.**

### `.card` is inert in BOTH systems — do NOT "fix" it to `.panel`

**Verified 2026-07-16 (ISSUE-247).** `.card` appears as a CSS **selector 0 times in legacy** and **0 times in our theme**, yet legacy writes `class="card"` **3 times**. So it is an **inert legacy artifact, faithfully ported** — identical rendering in both. **Parity. Leave it.**

**Swapping it to `.panel` would ADD** `background: var(--bg2)`, a `1px solid var(--border)`, `border-radius`, `overflow:hidden` and `margin-bottom:16px` — **none of which legacy renders.** That is the `.stat-card.blue` mistake exactly: shipping a visual legacy never shows.

**The tell:** there is exactly **one** `className="card"` in the whole web app — consistent with an inert artifact, not a styling decision.

*(The orchestrator's briefs carried "`.card` → use `.panel`" for ~30 batches. An agent caught it. **An absent class is not automatically a bug — check whether legacy defines it either.**)*

### `_mob*` functions are NOT a spec source

Different shell: keyed on `_mobPage`, dispatched into `getElementById('mobBody')` (L28224), **never reachable from the desktop `render()` router**. Their `mob-*` vocabulary has **zero occurrences** in `apps/web/src/styles/`, and the screens are strict **subsets** — porting one would *delete* working fields. Confirmed independently by three agents.

### `<th className="td-ctr">` / `td-right` — inert, but CHECK WHAT LEGACY WRITES AT THAT HEADER

Legacy's `.panel table th` (0,1,2) and our `.innovic-table th` (0,1,1) both out-specify `.td-ctr` / `.td-right` (0,1,0). So a **class** on a `<th>` does nothing — **in either system.**

**But that only makes it PARITY when legacy also uses a class.** Decide per site:

| Legacy writes | In legacy | In ours | Verdict |
| --- | --- | --- | --- |
| `<th class="td-ctr">` / `td-right` | **inert** | inert | **PARITY — do not touch** |
| **`<th style="text-align:right">`** | **APPLIES** (inline beats all) | inert | **🔴 REAL DIVERGENCE — mirror legacy's inline style** |

**Real instance (ISSUE-241):** Pending SO Value had six money headers rendering **left** because ours used `className="td-right"` while **legacy used the inline form**. Fixed by mirroring the inline style.

**Scope, measured:** **37** `<th className="td-right">` and **183** `<th className="td-ctr">` sites in `apps/web/src`. **Do NOT sweep these mechanically** — a blanket conversion would manufacture divergences on the 183 that are correctly inert. **Check the legacy header, site by site.**

**Unchanged:** `td-ctr` on a `<span>` **is** a real bug → move it to the `<td>`. Do **not** move `td-code` span→`<td>` (ISSUE-059).

### Our zebra rule can eat a faithfully-ported `<tr>` background (ISSUE-242)

`.innovic-table tbody tr:nth-child(even) td` paints **cells**, which cover any `<tr>` background. **Legacy has no zebra rule**, so its `<tr style="background:var(--bg4)">` totals row always shows; ours **vanishes on even indices**. **Put the background on the cells.**

*General shape: our theme adds rules legacy didn't have, so a faithfully-ported inline style can lose to one. The inverse of the `.stat-card.blue` trap (legacy referencing a rule that doesn't exist). Both are "the cascade differs", not "the markup differs."*

## Two traps that have already shipped defects (CHECK BOTH, EVERY PAGE)

### Trap 1 — copying legacy TEXT that describes a feature the React port never got

Legacy text often refers to legacy *features*. Copying the sentence without
checking the feature exists leaves the page advertising something it can't do.

Real example (Daily Report): the tip was copied verbatim as "Each machine panel
has its own 🖨 print button" — but the per-machine buttons were never ported.
The page told users to click a button that did not exist.

**Rule:** when legacy text mentions a button, column, panel, link, or action,
grep the React file to confirm that thing is actually there. If it is missing,
BUILD IT (it is a real parity gap, and finding these is the point of this pass).
Never ship text describing a feature the page lacks.

### Trap 2 — copying legacy attributes that do nothing, over React behavior that works

Legacy has dead attributes. Copying one while deleting a working React
equivalent is a pure regression with zero visual gain.

Real example (Daily Task Reports): `placeholder="From"` on `<input type="date">`
renders nothing in any browser — legacy included. The pass swapped React's
working `title` tooltip for it, deleting the only From/To hint for no gain.

**Rule:** if a legacy attribute provably has no rendered effect AND React has a
working equivalent, keep both — legacy-faithful markup plus the behavior that
works. Log the delta in `docs/ISSUES.md` (see ISSUE-017).

**This does NOT loosen parity.** Genuine legacy behavior is still the spec even
when it looks wrong — e.g. `full_outsource → 🏭 Mfg` in the Planning dashboard is
deliberate. Trap 2 is only for attributes with NO rendered effect at all.

## What NOT to change

- `apps/api/*` — backend stays untouched
- `router.tsx` — routes stay
- `api.ts` files — query hooks stay
- Zod schemas in `packages/shared/` — types stay
- `react-hook-form` register/control/errors usage
- TanStack Query keys
- URL-state pagination params
- TypeScript types

## What NOT to add

- New libraries
- New shadcn components (only existing ones)
- Tailwind utility classes for layout (use `.panel`, `.section-hdr` etc.)
- New routes
- New API endpoints

## Verification (REQUIRED before reporting done)

```bash
cd apps/web && pnpm typecheck
cd apps/web && pnpm lint
cd apps/web && pnpm test
```

If any of these fail, do NOT proceed. Fix errors first. If errors are
unrelated to the changes made, report to user before commit.

## Commit

After verification passes:
```bash
git add apps/web/src/modules/<module>/
git commit -m "refactor(web): UI-<NN> <module> <type> uses legacy chrome"
```

Use sequential 2-digit number for `<NN>`. Check existing commits for next
number: `git log --oneline | grep "UI-" | head -1`

## Report format

After successful refactor:

```
✅ <Module> <type> page refactored to legacy chrome

Reference: legacy HTML render<Name>() at line <N>
File: apps/web/src/modules/<module>/routes/<type>.tsx

Changes applied:
- Replaced <main> wrapper with a bare <div> (legacy has no wrapper class)
- Replaced page header with .section-hdr / .section-title / .section-actions
- Replaced shadcn <Table> with .panel + .innovic-table structure
- Replaced filter divs with .filter-bar
- Replaced action buttons with .btn .btn-ghost .btn-sm (there is NO .btn-outline)
- Replaced status badges with .badge .b-{color}
- Replaced empty state with .empty-state component

Verification:
- TypeScript: clean
- Lint: clean
- Tests: <N> passing

Commit: <hash>
Message: refactor(web): UI-<NN> <module> <type> uses legacy chrome

To verify visually:
  pnpm dev
  Open http://localhost:5173<route>

Next page suggestion: <next route from order>
```

## Order for batch refactoring (when user asks "what's next")

Easiest to hardest:
1. /items
2. /clients
3. /vendors
4. /machines
5. /operators
6. /purchase-requests
7. /purchase-orders
8. /goods-receipt-notes
9. /job-work-orders
10. /sales-orders
11. /nc-register
12. /delivery-challans

Then forms in same order. Then detail pages.

## When to escalate to user

Ask the user when:
- Legacy `render<Name>()` function doesn't exist in HTML
- Multiple matching legacy functions exist
- Legacy uses backend features not yet built (defer per LEGACY_AUDIT.md)
- Tests fail in ways unrelated to UI changes
- The page already matches legacy (no work needed)
- User requested batched pages — refactor first, ask which next

## What NOT to do

- Don't batch multiple pages in one go
- Don't skip the legacy HTML reading
- Don't skip typecheck/lint/test
- Don't auto-proceed to next page after finishing
- Don't invent CSS classes — use only what's in innovic-theme.css
- Don't add shadcn components for things that have legacy classes
- Don't change Tailwind config
- Don't modify the legacy folder (it's reference only)
