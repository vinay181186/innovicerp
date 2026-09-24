# Innovic ERP — Component Reference

Authoritative component inventory. Every class name, value and snippet below is copied
from the real stylesheet:

- `apps/web/src/styles/innovic-theme.css` (1630 lines) — all component classes
- `apps/web/src/styles/tokens.css` (190 lines) — the `:root` variables they consume
- `apps/web/src/index.css` — loads tokens → theme, plus a duplicated `#app-shell` /
  `#main` / `#content` safety-net block (see §1.6)

Markup snippets are copied from real usage under `apps/web/src/modules/` and
`apps/web/src/components/`; the source file is named above each one.

Load order (`index.css` lines 6–7):

```css
@import './styles/tokens.css';
@import './styles/innovic-theme.css';
```

---

## 1. Layout shell

### 1.1 Shell containers

```css
#app-shell { display: flex; height: 100vh; overflow: hidden; }
#sidebar {
  width: var(--sidebar-width); min-width: var(--sidebar-width);   /* 220px */
  background: var(--bg2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; z-index: 10; overflow-y: auto;
}
#main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
#content { flex: 1; overflow-y: auto; }
#main > #content { padding: 0 20px 20px; }
#content > *:first-child { margin-top: 0 !important; }
```

- `#content` is the **only** scroll container. `#content > *:first-child { margin-top: 0 !important }`
  exists because a scroll container clips block-start overflow: a negative top margin on a
  page root would lose its first pixels under the chrome. Side/bottom negative margins still work.
- `#main > #content` is written with the descendant combinator on purpose — `index.css`
  keeps a duplicate `#content { padding: 20px }` and loads later, so a plain `#content`
  rule in the theme would lose the cascade.
- `.innovic-body` paints the page: `background: var(--bg); color: var(--text); font-family: var(--bfont); font-size: var(--fs-body)`.

### 1.2 Header chrome — one surface

`#app-header` wraps the topnav, the tab strip and the breadcrumb trail and paints the
background for all three. The bands themselves are transparent — giving each its own
colour is what made the header read as three mismatched strips. The chrome closes with
**exactly one hairline**: `#pagetabs`' `border-bottom`. No second border below it.

```css
#app-header {
  flex-shrink: 0;
  background: var(--bg2);
  padding-bottom: 6px;   /* the page's top gutter, painted in header colour, never scrolls */
}
```

The 6px gutter lives on the header (not on `#content`'s padding-top) so a toolbar pinned
at `top: 0` inside a list sits flush under the chrome from the start instead of jumping.

Real markup — `apps/web/src/routes/_authenticated.tsx`:

```jsx
<div id="app-shell">
  <div id="main">
    <header id="app-header">
      <TopNav />
      <OpenTabsBar />
      <Breadcrumbs />
    </header>
    <div id="content">
      <Outlet />
    </div>
  </div>
</div>
```

### 1.3 Top navigation — `#topnav` and `.tn-*`

One 54px band: logo, Dashboard, twelve module dropdown buttons, then the right cluster
(search, sync dot, password, sign out, avatar). Module buttons are label-only.

```css
#topnav {
  min-height: var(--topbar-height);   /* 54px */
  display: flex; flex-wrap: wrap; align-items: center; gap: 0; padding: 0 12px;
  border-bottom: 1px solid var(--border); position: relative; z-index: 60;
}
```

| Class | Purpose | Key declarations |
| --- | --- | --- |
| `.tn-logo` / `.tn-logo img` | brand mark | `margin-right: 10px; flex-shrink: 0` · img `height: 24px; width: auto` |
| `.tn-sec` | module button + its menu | `position: relative; flex-shrink: 0` |
| `.tn-item` | module button / Dashboard link | `height: 36px; padding: 0 8px; border: 0; background: transparent; border-radius: 8px; font-size: 12.5px; font-weight: 500; color: var(--text2); white-space: nowrap` |
| `.tn-item:hover` | | `background: var(--bg3); color: var(--text)` |
| `.tn-item.active` | menu open OR current page in that module | `background: var(--blue3); color: var(--blue); font-weight: 600` |
| `.tn-caret` | dropdown arrow | `font-size: 9px; opacity: .7` |
| `.tn-menu` | white card under the button | `position: absolute; top: 42px; left: 0; min-width: 220px; padding: 10px 6px; background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-drawer, 0 10px 30px rgba(20,28,40,.16)); z-index: 70` |
| `.tn-menu.flip` | button in right half of screen | `left: auto; right: 0` |
| `.tn-col` | one group column (Entry / Master / …) | `min-width: 200px; padding: 4px 8px` |
| `.tn-col + .tn-col` | | `border-left: 1px solid var(--border)` |
| `.tn-col-label` | group heading | `font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text3); font-weight: 700; padding: 4px 10px 6px` |
| `.tn-link` | page link in the menu | `padding: 7px 10px; border-radius: 7px; color: var(--text); font-size: 13px; white-space: nowrap` |
| `.tn-link:hover` | | `background: var(--bg3)` |
| `.tn-link.on` | current page | `background: var(--blue3); color: var(--blue); font-weight: 600` |
| `.tn-link-icon` | | `width: 18px; text-align: center; flex-shrink: 0` |
| `.tn-right` | right cluster | `margin-left: auto; display: flex; gap: 8px; flex-shrink: 0` |
| `.tn-sync` | sync indicator wrapper | `display: inline-flex; padding: 0 2px` |
| `.tn-iconbtn` | icon-only header button | `padding: 0 8px; height: 32px` |
| `.tn-avatar` | | `width/height: 30px; border-radius: 50%; background: var(--blue3); color: var(--blue); font-weight: 700; font-size: 12px; cursor: default` |
| `#topnav .innovic-input.gs-input` | header search width | `width: 190px` |

### 1.4 Breadcrumbs + open-page tab strip

```css
#breadcrumbs {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 11px; color: var(--text3); padding: 5px 20px 0;
}
#pagetabs {
  display: flex; align-items: stretch; gap: 4px; padding: 3px 20px 0;
  border-bottom: 1px solid var(--border); overflow: hidden; flex-shrink: 0;
}
```

Both mirror `#content`'s 20px horizontal padding so every band lines up with the page body.
The tab strip has **no horizontal scroll**: tabs share the row and shrink (labels ellipsize),
backed by the store's `MAX_TABS` cap.

| Class | Key declarations |
| --- | --- |
| `.pgtab` | `flex: 0 1 auto; min-width: 0; padding: 3px 6px 3px 10px; font-size: 12px; color: var(--text2); background: var(--bg4); border: 1px solid var(--border); border-bottom: none; border-radius: 6px 6px 0 0; white-space: nowrap; max-width: 200px` |
| `.pgtab:hover` | `background: var(--bg2); color: var(--text)` |
| `.pgtab.active` | `background: var(--bg2); color: var(--blue); font-weight: 700; border-top: 2px solid var(--blue); padding-top: 2px` |
| `.pgtab-icon` | `flex-shrink: 0` |
| `.pgtab-label` | `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis` |
| `.pgtab-close` | `width/height: 16px; border: none; background: transparent; color: var(--text3); font-size: 14px; line-height: 1; border-radius: 4px` |
| `.pgtab-close:hover` | `background: var(--red3); color: var(--red)` |

Real markup — `apps/web/src/components/shared/open-tabs-bar.tsx`:

```jsx
<div id="pagetabs">
  <Link key={t.base} to={t.path} className={`pgtab${active ? ' active' : ''}`} title={t.label}>
    <span className="pgtab-icon" aria-hidden>{icon}</span>
    <span className="pgtab-label">{t.label}</span>
    <button className="pgtab-close" onClick={…}>×</button>
  </Link>
</div>
```

Breadcrumbs are a `<nav id="breadcrumbs" aria-label="Breadcrumb">` (`components/shared/breadcrumbs.tsx`) — layout lives entirely in CSS.

### 1.5 Sidebar remnants (`#sidebar`, `.sb-*`)

Still in the stylesheet; the shipped shell (`_authenticated.tsx`) renders no `#sidebar`.
Kept because the mobile drawer rule and the department tint classes are referenced.

| Class | Key declarations |
| --- | --- |
| `.sb-logo` | `padding: 16px 16px 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px` |
| `.sb-company` | `font-family: var(--hfont); font-size: var(--fs-heading); font-weight: 700; letter-spacing: .04em` |
| `.sb-sub` | `font-size: 11px; color: var(--cyan); letter-spacing: .12em; text-transform: uppercase; font-family: var(--mono)` |
| `.sb-section` | `font-size: var(--fs-label); letter-spacing: .1em; uppercase; padding: 8px 12px; font-weight: 800; margin: 4px 8px 2px; border-radius: var(--radius-sm); border-left: 3px solid var(--border2); background: var(--bg3); transition: all .15s` |
| `.sb-mod-*` | ten department tints — `planning, sales, store, production, qc, design, purchase, finance, tasks, system`; each sets `border-left-color` + `color` to `var(--dept-<name>) !important` |
| `.sb-item` | `padding: 9px 16px; color: var(--text2); font-size: var(--fs-control); border-left: 3px solid transparent` |
| `.sb-item.active` | `background: var(--blue3); color: var(--blue); border-left-color: var(--blue)` — flat wash, no gradient |
| `.sb-grp` / `.sb-icon` | `font-size: 11px; uppercase; pointer-events: none` · `width: 20px; text-align: center; font-size: 14px` |
| `.sb-bottom` / `.sb-user` / `.sb-avatar` / `.sb-uname` / `.sb-urole` | footer user block; avatar `28px`, `background: var(--blue)`, `color: #fff`, `font-family: var(--mono)` |

### 1.6 Topbar (`#topbar`, `.tb-*`) and sync dot

```css
#topbar {
  height: var(--topbar-height);
  min-height: var(--topbar-height);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 12px;
}
```

- `.tb-left` — `flex: 1 1 0; min-width: 0; overflow: hidden` (logo clips inside its half rather than painting under the search box).
- `.tb-title` — `font-family: var(--hfont); font-size: 20px; font-weight: 700; letter-spacing: .02em; flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- `.tb-right` — `flex: 1 1 0; min-width: max-content; justify-content: flex-end; gap: 12px` (same basis as `.tb-left` so the search box is centred).
- `.tb-sync` — `font-size: var(--fs-label); color: var(--text3); font-family: var(--mono)`.
- `.sync-dot` — `7px` circle, `background: var(--green)`; `.offline` → `var(--amber)` + `box-shadow: 0 0 6px var(--amber)`; `.error` → `var(--red)`.

---

## 2. Panels / cards

```css
.panel {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: var(--radius2);   /* 8px */
  overflow: hidden; margin-bottom: 10px;   /* density pass: was 16 */
}
.panel-hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px;               /* was 12px 16px — the header holds one line */
  border-bottom: 1px solid var(--border); background: var(--bg3);
}
.panel-title {
  font-family: var(--hfont); font-size: 16px; font-weight: 700;
  letter-spacing: 0.03em; margin: 0;   /* so the class can be worn by an <h2> */
}
.panel-body { padding: 12px; }     /* was 16 */
.section-hdr {
  font-family: var(--hfont); font-size: var(--fs-section);   /* 22px */
  font-weight: 700; margin-bottom: 16px; letter-spacing: 0.01em;
}
.divider { height: 1px; background: var(--border); margin: 16px 0; }
```

`.panel` carries **no shadow**. `margin: 0` on `.panel-title` is deliberate: panel titles
are the page's section headings and should be real `<h2>`s, not `<span>`s — a page whose
every heading is a `<span>` has no outline for screen readers.

Real markup — `apps/web/src/modules/sales-orders/routes/detail.tsx`:

```jsx
<div className="panel">
  <div className="panel-hdr">
    <div className="panel-title" style={{ color: 'var(--blue)', textTransform: 'uppercase' }}>
      Line items ({detail.lines.length})
    </div>
    <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
      total qty <b style={{ color: 'var(--text)' }}>{totalQty}</b>
    </span>
  </div>
  <div className="panel-body">…</div>
</div>
```

### Left-accent stripe pattern

There is no `.panel-accent` class. The left-stripe convention appears in three places:

1. `.sb-section` / `.sb-mod-*` — `border-left: 3px solid var(--border2)`, overridden per department to `var(--dept-*)`.
2. `.sb-item.active` — `border-left-color: var(--blue)`.
3. `.qc-alert-blink` — `border-left: 3px solid var(--red) !important`.

Panels themselves get their accent as a **top** bar via `.stat-card::after` (§8), not a left stripe.

### Clickable surfaces — `.dash-link` / `.dash-surface`

Put `.dash-link` on the `<a>`/`<Link>` (that is what receives focus) and `.dash-surface`
on the bordered box inside it.

```css
.dash-link { display: block; text-decoration: none; color: inherit; border-radius: var(--radius2); }
.dash-link:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.dash-link:hover .dash-surface,
.dash-link:focus-visible .dash-surface { background: var(--bg4); border-color: var(--cyan); }
.dash-surface { transition: background .15s, border-color .15s; }
.dash-link.dash-cell { border-radius: 0; transition: background .15s; }
.dash-link.dash-cell:hover { background: var(--bg4); }
@media (prefers-reduced-motion: reduce) {
  .dash-surface, .dash-link.dash-cell { transition: none; }
}
```

`outline`, not `border-color`, on focus: it cannot be swallowed by the child's own border
and never removes the ring the browser would otherwise draw. `.dash-cell` is the variant
for a link with **no** bordered child (the StatStrip navigation cell) — it takes the hover
fill on itself.

---

## 3. Tables

### 3.1 Wrapper and base table

```css
.tbl-wrap { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 220px); position: relative; }
.innovic-table { width: 100%; border-collapse: collapse; }
.innovic-table th {
  background: var(--bg3); color: var(--text2);
  font-size: var(--fs-mono);        /* 11px */
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 6px 10px;                /* was 9px 12px */
  text-align: center; font-family: var(--mono); white-space: nowrap;
  border-bottom: 1px solid var(--border); cursor: pointer; user-select: none;
  position: sticky; top: 0; z-index: 5;
  box-shadow: inset 0 -1px 0 var(--border);
}
.innovic-table th:hover { color: var(--cyan); }
.innovic-table td {
  padding: 6px 10px; border-bottom: 1px solid var(--border);
  font-size: var(--fs-control);     /* 13px */
  vertical-align: middle; white-space: nowrap;
}
.innovic-table tbody tr:hover td { background: var(--bg4); }
```

- **No zebra striping** on the base table — rows are white, hover (`var(--bg4)`) is the only wash.
- `white-space: nowrap` on every `td` + `overflow-x: auto` on `.tbl-wrap` is the app's
  no-wrap-plus-side-scroll rule. `th` is `cursor: pointer` because headers sort.
- Sticky header sits at `z-index: 5` with `box-shadow: inset 0 -1px 0 var(--border)` (a
  real `border-bottom` would scroll away with the cell in a sticky context).

### 3.2 Alignment standard

```css
.innovic-table th,
.innovic-table td,
.ops-routing th,
.ops-routing td,
table.tbl-ctr th,
table.tbl-ctr td {
  text-align: center;
}
.innovic-table td .innovic-input,
.innovic-table td .innovic-select,
.ops-routing td .innovic-input,
.ops-routing td .innovic-select,
table.tbl-ctr td .innovic-input,
table.tbl-ctr td .innovic-select {
  text-align: center;
}
```

Every table centres **both** rows — the column name and the values under it share one
centre line. Headers left over centred data was tried on SO Master (2026-09-07) and
rejected: it left every value ~50px right of its own column name.

At (0,1,1) this selector already outranks the (0,1,0) helpers `.td-right` / `.td-ctr`,
so those still win nothing — but an inline `style={{ textAlign }}` on a cell beats both and
has to be deleted from the markup. `table.tbl-ctr` is the opt-in class for tables carrying
neither shared class.

### 3.3 Cell helpers

| Class | Declarations |
| --- | --- |
| `.td-code` | `font-family: var(--mono); font-weight: 600; font-size: 12px` |
| `.td-right` | `text-align: right` |
| `.td-ctr` | `text-align: center` |
| `.mono` | `font-family: var(--mono)` |
| `.fw-700` | `font-weight: 700` |
| `.text2` / `.text3` | `color: var(--text2)` / `color: var(--text3)` |
| `.cyan` | `color: var(--cyan)` |
| `.amber` / `.green` / `.red` | `color: var(--amber2)` / `var(--green2)` / `var(--red2)` — the dark "2" variants, because the solid signal colours fail 4.5:1 as text on white |

### 3.4 Frozen first column — `.tbl-frozen`

```css
.tbl-frozen tbody td:first-child,
.tbl-frozen thead th:first-child {
  position: sticky;
  left: 0;
  z-index: 4;
  background: var(--bg2);
  box-shadow: 2px 0 4px -2px rgba(0, 0, 0, 0.08);
}
.tbl-frozen thead th:first-child { z-index: 6; background: var(--bg3); }
.tbl-frozen tbody tr:hover td:first-child { background: var(--bg4); }
```

Composed as `<div class="tbl-wrap tbl-frozen">` on the widest tables (Job Cards, Sales
Orders, PO, GRN, Production Orders, Tasks). The explicit `background` rules keep the pinned
cell opaque — without them the scrolled content shows through.

Real markup — `apps/web/src/modules/production-orders/routes/list.tsx:397`:

```jsx
<div className="panel">
  <div className="tbl-wrap tbl-frozen">
    <table className="innovic-table">
      <SortableHead table={table} />
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={columns.length} className="empty-state">No production orders yet …</td></tr>
        ) : rows.map((row) => <tr key={row.id}>…</tr>)}
      </tbody>
    </table>
  </div>
</div>
```

### 3.5 Sheet variant — `.innovic-table.tbl-grid`

Opt-in ruled-sheet look (Plans / BOM Master / Clients). Everything on `.innovic-table`
still holds where a rule below does not override it.

```css
.innovic-table.tbl-grid {
  table-layout: fixed;
  border-top: 2px solid var(--blue2);
  border-bottom: 2px solid var(--blue2);
}
.innovic-table.tbl-grid th {
  background: var(--bg4); color: var(--blue2); font-family: var(--hfont);
  font-weight: 800; font-size: 11px; letter-spacing: 0.06em; padding: 8px 8px;
  border-right: 1px solid var(--border2); border-bottom: 1px solid var(--blue2);
  box-shadow: none; text-align: center;
}
.innovic-table.tbl-grid td {
  font-size: 13px; padding: 8px 8px;
  border-right: 1px solid var(--border2); border-bottom: 1px solid var(--border2);
  text-align: center; white-space: normal; overflow-wrap: anywhere;
}
.innovic-table.tbl-grid tbody tr td { background: var(--bg2); }
.innovic-table.tbl-grid tbody tr:nth-child(odd) td { background: #fffbf2; }
.innovic-table.tbl-grid tbody tr:hover td { background: var(--bg4); }
.innovic-table.tbl-grid .td-code { font-size: 13px; font-weight: 700; color: var(--blue); }
```

- `#fffbf2` is the **one** literal hex in the file besides `#fff` on solid buttons — the
  cream alternating row of the reference sheet.
- `--border2`, not `--border`, on the gridlines: `index.css`'s shadcn block redefines
  `--border` as an HSL triplet, so `1px solid var(--border)` is invalid at computed time
  and the browser drops the whole declaration.
- `th:last-child` / `td:last-child` drop `border-right`.
- Buttons inside the last column: `.tbl-grid .btn-sm` → `padding: 3px 9px; font-size: 11px; font-weight: 700; border: 1px solid var(--border3); background: var(--bg2)`; `.btn-sm.btn-primary` → `background/border-color: var(--blue); color: #fff`. Actions stack (`display: inline-block; margin: 1px 0`) so the column never widens.
- `.jc-row-acts .btn-sm` (Job Card list) → `inline-flex; gap: 4px; padding: 2px 6px; height: 24px`.

```jsx
{/* apps/web/src/modules/bom-master/routes/list.tsx:194 */}
<table className="innovic-table tbl-grid">…</table>
```

### 3.6 Modal tables — `.ops-routing`

```css
.ops-routing { width: 100%; border-collapse: collapse; }
.ops-routing th {
  padding: 8px 12px; text-align: center; font-family: var(--mono);
  font-size: var(--fs-mono); text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 700; color: var(--text2); white-space: nowrap;
}
.ops-routing td { padding: 8px 12px; vertical-align: middle; border-top: 1px solid var(--border); text-align: center; }
```

Used for the Plan modal's Operations Routing + Required QC Documents tables — raw modal
tables have no cell padding otherwise.

### 3.7 Search results table — `.gs-results`

`table-layout: fixed; width: 100%` with fixed `<col>` widths so the table never grows a
sideways scrollbar: `.gs-col-date 100px`, `.gs-col-type 110px`, `.gs-col-docno 170px`,
`.gs-col-party 180px`, `.gs-col-qty 70px`, `.gs-col-status 120px`. Particulars takes the
slack. `td.gs-ellipsis` → `overflow: hidden; text-overflow: ellipsis`; `td.gs-lines` →
`white-space: normal; overflow-wrap: anywhere`. `.gs-results .innovic-table th { cursor: default }`
(these headers do not sort).

---

## 4. Buttons

```css
.btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
  border-radius: var(--radius);      /* 6px */
  border: 1px solid transparent; cursor: pointer; font-family: var(--bfont);
  font-size: var(--fs-control);      /* 13px */
  font-weight: 600; transition: all 0.15s; white-space: nowrap;
}
.btn-primary { background: var(--blue); color: #fff; }
.btn-primary:hover { background: var(--blue2); }
.btn-success { background: var(--green2); color: #fff; }
.btn-success:hover { background: var(--green2-hover); }
.btn-danger { background: var(--red2); color: #fff; }
.btn-danger:hover { background: var(--red2-hover); }
.btn-ghost { background: var(--bg2); color: var(--text2); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--bg3); color: var(--text); border-color: var(--border2); }
.btn-sm { padding: 4px 10px; font-size: var(--fs-label); }   /* 11px */
.btn-icon { padding: 6px 8px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

Complete variant list: `.btn-primary`, `.btn-success`, `.btn-danger`, `.btn-ghost`.
Sizes: default, `.btn-sm`, `.btn-icon`. There is **no** `.btn-secondary`, `.btn-warning`,
`.btn-lg` or `.btn-link`.

- The `1px solid transparent` border + `7px 12px` padding makes `.btn` exactly the same
  height (~32px) as `.innovic-input`, so a filter row lines up.
- Solid success/danger sit on the **"2" dark** value (white text passes 4.5:1) and hover
  **darkens** to `-hover`; they never lighten to the raw signal colour, which would drop
  white text below 3:1.

Real markup — `apps/web/src/modules/sales-orders/routes/list.tsx`:

```jsx
<Link to="/sales-orders/new" className="btn btn-primary">+ New SO / WO</Link>
<button type="button" className="btn btn-ghost btn-sm" disabled={exporting} onClick={() => void onExport()}>
  Export
</button>
<button type="button" className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}>…</button>
<button type="button" className="btn btn-danger btn-sm" onClick={() => onDeleteSo(so)}>Delete</button>
```

The `btn-primary` / `btn-ghost` swap on a shared `btn-sm` is the standard segmented-toggle
pattern (list/card view switch, status filter pills).

---

## 5. Badges / pills / chips

```css
.badge {
  display: inline-flex; align-items: center; padding: 2px 8px;
  border-radius: var(--radius-sm);   /* 4px — rounded-rect, not a full pill */
  font-size: var(--fs-mono);         /* 11px */
  font-weight: 700; letter-spacing: 0.05em; font-family: var(--mono);
  white-space: nowrap; text-transform: uppercase;
}
```

Every colour variant is `color` + `background` + `border: 1px solid transparent` (the
transparent border keeps all badges the same height as the pre-2026-09 outlined ones).

| Class | color | background | Used for |
| --- | --- | --- | --- |
| `.b-green` | `var(--green2)` | `var(--green3)` | done / ready / approved |
| `.b-amber` | `var(--amber2)` | `var(--amber3)` | pending / warning |
| `.b-blue` | `var(--blue)` | `var(--blue3)` | in progress / planned |
| `.b-red` | `var(--red2)` | `var(--red3)` | rejected / overdue |
| `.b-grey` | `var(--text2)` | `var(--bg4)` | neutral / type chips |
| `.b-cyan` | `var(--cyan)` | `var(--cyan3)` | informational |
| `.b-orange` | `var(--orange2)` | `var(--orange3)` | hold / rework |
| `.b-teal` | `var(--teal2)` | `var(--teal3)` | assembly "Done" — distinguished from green "Ready" |
| `.b-purple` | `var(--purple2)` | `var(--purple3)` | OSP / vendor / QC op-type. Dark text because solid `--purple` is only 4.1:1 on `--purple3` |

Nine variants; there is no `.b-black`, `.b-white` or outline modifier.

Real markup — `apps/web/src/modules/sales-orders/routes/list.tsx`:

```jsx
<span className="badge b-grey">{so.type.replaceAll('_', ' ')}</span>
<span className={`badge ${
  so.bomStatus === 'BOM Pending' ? 'b-amber'
  : so.bomStatus === 'BOM Planned' ? 'b-green'
  : 'b-blue'
}`}>{so.bomStatus}</span>
```

Status-pill convention: each module owns a `*-status-badge.tsx` component
(`so-status-badge`, `jc-status-badge`, `nc-status-badge`, `pr-status-badge`, …) that maps
a status string to one `b-*` class. Never inline a hex on a badge.

### Square chip — `.tag`

```css
.tag {
  display: inline-block; padding: 1px 6px; border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; font-family: var(--mono);
}
```

Distinct from `.badge`: `.tag` declares **no** colour, so callers pass one
(`style={{ background: 'var(--green3)', color: 'var(--green2)' }}` in
`modules/job-cards/components/jc-op-card.tsx:465`). Used for inline chips — Item Master
UOM cell, Route Card Rev, JC op-type.

### Task Board chips

```css
.task-unread {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--sig-critical); margin-right: 6px; vertical-align: middle;
  box-shadow: 0 0 0 2px var(--sig-critical-bg);
}
.task-linked-ref {
  display: inline-block; font-family: var(--mono); font-size: 11px;
  padding: 1px 6px; border-radius: var(--radius-sm);
  background: var(--blue3); color: var(--blue); font-weight: 700; margin-left: 4px;
}
```

`.task-linked-ref` is a blue mono **square** chip, not a cyan pill — `badge b-cyan` was the
wrong approximation. Used in `modules/tasks/components/related-ref-link.tsx:22`;
`.task-unread` in `modules/tasks/components/task-table.tsx:72`.

---

## 6. Forms

```css
.form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.form-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.form-span-2 { grid-column: span 2; }
.form-full   { grid-column: 1 / -1; }
.form-grp    { display: flex; flex-direction: column; gap: 4px; }
.form-label {
  font-size: var(--fs-label);      /* 11px */
  color: var(--text2); font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; font-family: var(--mono);
}
.form-label .req { color: var(--red2); margin-left: 2px; }
.form-error { font-size: var(--fs-label); color: var(--red2); margin-top: 2px; }
.form-help  { font-size: var(--fs-label); color: var(--text3); margin-top: 2px; }
```

`.form-grid-4` is the document-header grid — doc no · date · due date · type / client ·
client PO · GST above the fold instead of four 2-up rows. Compose with `.form-span-2` for
wide fields.

### Controls

```css
.innovic-input,
.innovic-select,
.innovic-textarea {
  background: var(--bg2); color: var(--text); border: 1px solid var(--border);
  border-radius: var(--radius);     /* 6px */
  padding: 7px 10px; font-family: var(--bfont);
  font-size: var(--fs-control);     /* 13px */
  width: 100%; outline: none; transition: border 0.15s;
}
.innovic-input:focus,
.innovic-select:focus,
.innovic-textarea:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px var(--focus-ring);   /* rgba(21,94,239,.15) */
}
.innovic-input[readonly] { opacity: 0.6; cursor: not-allowed; }
```

The focus ring is `border-color: var(--blue)` + a 3px `--focus-ring` halo. There is **no**
`:disabled` rule on the inputs — only `[readonly]`. `.innovic-textarea` shares the base
rule but has no size rule of its own; height is set per usage.

Required marker: a literal `★` inside `<span className="req">`, red (`var(--red2)`).

Real markup — `apps/web/src/modules/clients/components/client-form.tsx:108-127`:

```jsx
<div className="form-grp form-full">
  <label className="form-label" htmlFor="code">Code</label>
  <input id="code" className="innovic-input" readOnly autoComplete="off"
         placeholder="Auto-generated on save" {...register('code', {…})} />
  <div className="form-help">Generated automatically in series (CLI-…) when you save.</div>
  {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
</div>
<div className="form-grp form-full">
  <label className="form-label" htmlFor="name">
    Client Name<span className="req">★</span>
  </label>
  <input id="name" className="innovic-input" autoFocus autoComplete="off"
         placeholder="Full company name" {...register('name')} />
  {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
</div>
```

### Global search input — `.gs-*`

```css
.gs-wrap { position: relative; flex-shrink: 0; }
.gs-icon { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--text3); pointer-events: none; }
.innovic-input.gs-input { width: 260px; height: 32px; padding: 6px 10px 6px 28px; font-size: 12px; }
```

Width is narrowed to 190px inside `#topnav`, 150px under 1350px, 120px under 768px.

---

## 7. Modals / overlays

```css
.overlay {
  position: fixed; inset: 0;
  background: var(--overlay-bg);     /* rgba(23,43,77,.45) */
  z-index: 500; display: flex; align-items: flex-start; justify-content: center;
  padding: 2vh 2vw; backdrop-filter: blur(2px);
}
.modal {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: var(--radius2); width: 100%;
  max-width: min(1100px, 96vw); min-height: min(86vh, 640px); max-height: 96vh;
  overflow-y: auto;
  box-shadow: var(--shadow-modal);   /* 0 8px 24px rgba(23,43,77,.12) */
}
.modal-lg { max-width: min(1320px, 96vw); }
.app-sheet {
  width: min(1100px, 96vw) !important; max-width: min(1100px, 96vw) !important;
  min-height: min(86vh, 640px); max-height: 96vh; overflow-y: auto;
}
.modal-hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg3);
}
.modal-title { font-family: var(--hfont); font-size: 17px; font-weight: 700; }
.modal-body { padding: 16px; }
.modal-footer {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 16px; border-top: 1px solid var(--border); background: var(--bg3);
}
```

Popups are **full-window page-style**, not cramped centred boxes: wide, tall
(`min-height: min(86vh, 640px)`), with internal scroll. `align-items: flex-start` on the
overlay pins the modal to the top. `.app-sheet` is the opt-in class for an inline (non-`.modal`)
fixed overlay panel whose inline width cap needs overriding — currently declared but not
used in `modules/`.

Real markup — `apps/web/src/modules/tasks/components/task-overlay.tsx:60-74`:

```jsx
<div className="overlay" onMouseDown={(e) => { if (e.target !== e.currentTarget) return; onClose(); }}>
  <div className={size === 'lg' ? 'modal modal-lg' : 'modal'}
       style={SIZE_STYLE[size]} role="dialog" aria-modal="true"
       onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-hdr">
      <div className="modal-title">{title}</div>
      <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
    </div>
    <div className="modal-body">{children}</div>
    <div className="modal-footer">…</div>
  </div>
</div>
```

### Search popup — `.overlay.gs-overlay`

Starts **below** the top bar so the search box stays visible, focused and editable above it.

```css
.overlay.gs-overlay { top: var(--topbar-height); align-items: stretch; padding: 8px 12px 12px; }
.gs-overlay .modal { max-width: none; width: 100%; min-height: 0; max-height: 100%;
                     display: flex; flex-direction: column; overflow: hidden; }
.gs-overlay .modal-hdr  { flex: 0 0 auto; }
.gs-overlay .modal-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.gs-overlay .gs-results-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.gs-overlay .tbl-wrap   { flex: 1 1 auto; min-height: 0; max-height: none; }
```

Flex column top-to-bottom so the results table is the popup's **one** scroller and its
sticky header holds, whatever height the summary + count strip take.

### 7.1 Z-index ladder (every `z-index` in the file)

| Value | Selector | Line |
| --- | --- | --- |
| 4 | `.tbl-frozen tbody td:first-child`, `.tbl-frozen thead th:first-child` | 936 |
| 5 | `.innovic-table th` (sticky header) | 768 |
| 6 | `.tbl-frozen thead th:first-child` (corner cell — above both) | 941 |
| 10 | `#sidebar` | 52 |
| 60 | `#topnav` | 111 |
| 70 | `.tn-menu` (module dropdown) | 183 |
| 200 | `#sidebar` inside `@media (max-width: 768px)` — the mobile drawer | 1413 |
| 500 | `.overlay` | 1234 |
| 9999 | `#toast` | 1297 |

Nine `z-index` declarations, no others anywhere in `apps/web/src/**/*.css`.

---

## 8. Stat strip / KPI

### 8.1 `<StatStrip>` — the one way counts appear above a list

`apps/web/src/components/shared/stat-strip.tsx`. It reuses `.panel` as its container with
`padding: 0`; every other value is an inline style on the component, **not** a CSS class.

```jsx
<div className="panel" style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}>
  {/* one cell per stat */}
  <button type="button" aria-pressed={s.active ?? false} style={{
    flex: '1 1 140px', minWidth: 120, textAlign: 'left', padding: '8px 16px',
    background: 'transparent', border: 'none',
    borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
    borderBottom: `2px solid ${s.active ? (s.color ?? 'var(--cyan)') : 'transparent'}`,
    cursor: 'pointer', font: 'inherit',
  }}>
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: s.active ? (s.color ?? 'var(--cyan)') : 'var(--text3)' }}>{s.label}</div>
    <div className="mono fw-700" style={{ fontSize: 22, lineHeight: 1.15, color: s.color ?? 'var(--text)' }}>
      {s.count}
    </div>
    {s.sub ? <div className="text3" style={{ fontSize: 11 }}>{s.sub}</div> : null}
  </button>
</div>
```

- **Divider:** the only separator is `borderLeft: 1px solid var(--border)`, omitted on the first cell.
- **Active state:** the label turns its own colour and a `2px` bottom border appears in that
  colour. Never a ring or box around the cell — that reads as "selected card", not "filter on".
- **Three cell kinds** by prop: `to` → `<Link className="dash-link dash-cell">` (navigation,
  no `aria-pressed`); `onClick` → `<button aria-pressed>`; neither → plain `<div>` (a total,
  not announced as a control).

### 8.2 `.stat-grid` / `.stat-card` (dashboard tiles)

```css
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius2); padding: 12px 14px; position: relative; overflow: hidden; }
.stat-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
.stat-card.cyan::after  { background: var(--cyan); }
.stat-card.amber::after { background: var(--amber); }
.stat-card.green::after { background: var(--green); }
.stat-card.red::after   { background: var(--red); }
.stat-label { font-size: var(--fs-mono); color: var(--text3); text-transform: uppercase;
              letter-spacing: 0.1em; font-family: var(--mono); margin-bottom: 6px; }
.stat-val   { font-family: var(--hfont); font-size: var(--fs-stat); font-weight: 800; line-height: 1; }
.stat-sub   { font-size: var(--fs-label); color: var(--text3); margin-top: 4px; }
```

Exactly **four** accent variants — `cyan`, `amber`, `green`, `red`. There is deliberately
no `.stat-card.blue` or `.purple`: legacy writes `stat-card blue` on the QC/PO/GRN tiles
and they render a 2px bar with no background there too. Adding one would diverge from legacy.

Used on `modules/production-dashboard/routes/index.tsx:108` and
`modules/osp-wip/components/osp-at-vendor-register.tsx:287`. For a count row above a **list**,
use `<StatStrip>` instead (styling skill, Rule 3).

### 8.3 Progress bar

```css
.prog-wrap { background: var(--bg5); border-radius: var(--radius-sm); height: 6px; overflow: hidden; }
.prog-bar  { height: 100%; border-radius: var(--radius-sm); transition: width 0.4s ease; }
```

`.prog-bar` declares no colour or width — the caller sets both inline
(`modules/job-cards/components/jc-stat-tiles.tsx:289`).

---

## 9. Empty / loading states

```css
.empty-state { text-align: center; padding: 40px; color: var(--text3); }
.empty-icon  { font-size: 36px; margin-bottom: 8px; }
```

There is no separate loading class — loading, error and empty all reuse `.empty-state`,
with the error case overriding the colour inline.

Real markup — `apps/web/src/modules/production-orders/routes/list.tsx:400-424`:

```jsx
{isLoading ? (
  <tr><td colSpan={columns.length} className="empty-state">
    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…
  </td></tr>
) : isError ? (
  <tr><td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>
    {error instanceof Error ? error.message : 'Failed to load production orders'}
  </td></tr>
) : rows.length === 0 ? (
  <tr><td colSpan={columns.length} className="empty-state">
    No production orders yet — Production → Entry → Create Production Order.
  </td></tr>
) : …}
```

Outside a table it is composed onto a panel: `<div className="panel empty-state" style={{ padding: 24 }}>No orders — click + New SO/WO</div>` (`sales-orders/routes/list.tsx:423`).

---

## 10. Toast, scrollbars, focus, animation, print, responsive

### 10.1 Toast

```css
#toast {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.toast-item {
  padding: 10px 16px; border-radius: var(--radius); font-size: var(--fs-control);
  font-weight: 600; display: flex; align-items: center; gap: 8px;
  animation: toastSlideIn 0.2s ease; max-width: 320px;
  box-shadow: var(--shadow-toast);   /* 0 4px 12px rgba(23,43,77,.15) */
}
.toast-ok   { background: var(--green2); color: #fff; border: 1px solid var(--green); }
.toast-err  { background: var(--red2);   color: #fff; border: 1px solid var(--red); }
.toast-info { background: var(--blue);   color: #fff; border: 1px solid var(--blue2); }
@keyframes toastSlideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
```

Note: these classes are a legacy port and are currently **unreferenced** in
`apps/web/src/` — no component renders `#toast` / `.toast-item` today.

### 10.2 Scrollbars

```css
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: var(--bg2); }
::-webkit-scrollbar-thumb { background: var(--bg5); border-radius: var(--radius-sm); }
```

Global, 5px, no arrows.

### 10.3 Focus-visible

The file declares exactly **one** `:focus-visible` rule:

```css
.dash-link:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.dash-link:focus-visible .dash-surface { background: var(--bg4); border-color: var(--cyan); }
```

Form controls get their ring from `:focus` instead (`border-color: var(--blue)` +
`box-shadow: 0 0 0 3px var(--focus-ring)`). Every other element keeps the browser's default ring.

### 10.4 QC overdue blink

```css
@keyframes qcBlink {
  0%, 100% { background: rgba(240, 68, 56, 0.15); }
  50%      { background: rgba(240, 68, 56, 0.35); }
}
.qc-alert-blink { animation: qcBlink 1s ease-in-out infinite; border-left: 3px solid var(--red) !important; }
```

Applied to overdue pending QC rows in `modules/qc-call-register/routes/index.tsx:540` and
`modules/qc-history/routes/index.tsx:336`.

### 10.5 Print rules

`innovic-theme.css` contains **no `@media print` block**. Printing is not done from the
screen stylesheet — every printed document is generated into its own window by
`apps/web/src/lib/print/sheet-print.ts` (the "Innovic Sheet" standard), with
`lib/print/doc-print.ts`, `lib/print/print-window.ts`,
`modules/invoices/lib/print.ts` and `modules/items/lib/print-drawing.ts` carrying their own
`@media print` rules. Do not add print rules to the component stylesheet.

### 10.6 Responsive breakpoints — all three

**`@media (max-width: 1350px)`** — header cluster wrap:

```css
#topnav .innovic-input.gs-input { width: 150px; }
.tn-right { flex-basis: 100%; justify-content: flex-end; padding-bottom: 6px; }
```

Narrower than the ~1350px the twelve modules plus the search box need, the right cluster
drops to a second line rather than being pushed off the edge (`#main` clips, so there is
no scrollbar to recover it). The search box gives up width first.

**`@media (max-width: 1100px)`** — form fold:

```css
.form-grid-4 { grid-template-columns: 1fr 1fr; }
```

A 4-up row squeezes inputs below usable width between phone and desktop, so it folds to
2-up before the 768px single-column collapse.

**`@media (max-width: 768px)`** — mobile/tablet fallback. Changes, in file order:

| Selector | Change |
| --- | --- |
| `#sidebar` | becomes an off-canvas drawer: `position: fixed; left: -260px; top/bottom: 0; width: 250px; z-index: 200; transition: left .25s ease; box-shadow: var(--shadow-drawer)` |
| `#sidebar.sb-open` | `left: 0` |
| `#breadcrumbs` | `padding: 5px 20px 0` (20px, matching what actually ships) |
| `#pagetabs` | `padding: 3px 20px 0` |
| `#app-header` | `padding-bottom: 6px` |
| `#topnav` | `padding: 0 8px` — module buttons wrap onto as many lines as needed; no `overflow` on the band, or dropdowns would be clipped at its edge |
| `#topnav .innovic-input.gs-input` | `width: 120px` |
| `#main > #content` | `padding: 0 20px 20px` |
| `#topbar` | `padding: 0 20px; gap: 8px; min-height: 48px; height: 48px` |
| `.form-grid`, `.form-grid-3`, `.form-grid-4` | `grid-template-columns: 1fr !important` |
| `.form-span-2` | `grid-column: span 1` |
| `.modal` | `max-width/width: 100vw !important; max-height/height: 100vh !important; border-radius: 0 !important; margin: 0 !important` |
| `.overlay` | `padding: 0 !important; align-items: stretch !important` |
| `.stat-grid` | `grid-template-columns: repeat(2, 1fr)` |

A second `@media (max-width: 768px)` block at the end of the file handles search:
`.innovic-input.gs-input { width: 150px }`; `.overlay.gs-overlay { top: 48px }` (the topbar
is 48px here, not the token); `.gs-overlay .modal { height: auto !important; max-height: 100% !important }`
(the mobile `height: 100vh !important` would make the popup 48px taller than its overlay);
`.gs-results .innovic-table { table-layout: auto }` and all six `col.gs-col-*` widths back
to `auto` (the six fixed columns total 750px and would squeeze Particulars to nothing).

Edge padding is **20px at every breakpoint** for `#breadcrumbs`, `#pagetabs` and
`#content`. The 768px block used to ask for 12px, but `index.css`'s duplicate `#content`
rule loads later and has always overridden it — and two pages bleed sideways with a
hard-coded `margin: 0 -20px -20px`, so a real 12px would hang them past the edge and give
a phone a horizontal scrollbar.

---

## Hard rules encoded in this CSS

Stated by the file's own comments and by `tokens.css`:

1. **Never hard-code a hex.** `tokens.css` "IS the source of truth for colours, spacing,
   typography and radii — every component / page must consume these variables (or the
   Tailwind utilities derived from them) and never hard-code a hex." The only hex literals
   in the whole component sheet are `#fff` (solid button / avatar / toast text) and
   `#fffbf2`, the cream row of the `.tbl-grid` reference sheet. Four `rgba()` literals
   remain, all of them shadows or the blink keyframe: `rgba(0,0,0,.08)` on `.tbl-frozen`,
   `rgba(20,28,40,.16)` as the `.tn-menu` shadow *fallback*, and
   `rgba(240,68,56,.15/.35)` in `@keyframes qcBlink`.
2. **Panels carry no shadow.** "Restrained by design: panels carry no shadow at all." The
   only shadows that exist are `--shadow-modal`, `--shadow-toast`, `--shadow-drawer`, the
   3px `--focus-ring` halo, and the 2px pin shadow on `.tbl-frozen`.
3. **11px is the text floor.** `--fs-label` and `--fs-mono` are both `11px`; the density
   comment says "11px is the floor for any text." Body 14px, controls 13px.
4. **One interactive accent.** `--cyan` and `--blue` are the *same* Innovic blue
   (`#155eef`) on purpose — "The old teal 'cyan' left the app with two competing emphasis
   colours." Blue = buttons, page tabs, links; cyan = sidebar active, focus outline,
   `th:hover`, StatStrip underline.
5. **Solid colours are fills, text uses the "2" variant.** The 3-tier convention is
   solid / dark(`2`) / pale-wash(`3`): solid for dots, bars, borders and stat-card accents;
   any *text* in that hue takes the `2` value, which clears 4.5:1 on white or on the pale
   wash. Hover on a solid success/danger button darkens to `-hover`, never lightens.
6. **Tables get no-wrap + side scroll.** `.innovic-table td { white-space: nowrap }` plus
   `.tbl-wrap { overflow-x: auto }`. Short values (doc no., date, code, qty) stay on one
   line; the table scrolls sideways instead of wrapping. `.tbl-frozen` pins column 1 so the
   document number never scrolls away.
7. **No zebra rows on the base table.** "rows are white, hover is the only wash." The cream
   alternation exists only inside the opt-in `.tbl-grid` sheet variant.
8. **Both table rows centre.** Column name and values share one centre line, applied once
   globally (§3.2) rather than per table. Inline `style={{ textAlign }}` on a cell beats it
   and must be deleted from the markup, not out-specified.
9. **No gradients, 4/6/8px radii, compact padding.** `--radius-sm: 4px` for badges/chips,
   `--radius: 6px` for buttons/inputs/tabs, `--radius2: 8px` for panels/cards/modals.
10. **One hairline in the header chrome.** `#pagetabs`' `border-bottom`. "two lines 20px
    apart is the double-border look this was meant to remove." All three bands are
    transparent and `#app-header` paints them.
11. **`#content` is the only scroll container**, and nothing may pull itself above it —
    `#content > *:first-child { margin-top: 0 !important }`.
12. **Panel titles are headings.** `.panel-title { margin: 0 }` exists so the class can be
    worn by an `<h2>`: "a page whose every heading is a `<span>` is a page with no outline."
13. **New rules go in a separate "Innovic extensions" file** — every selector in
    `innovic-theme.css` is a literal port from the legacy stylesheet, restyled in place.
14. **Never define a token name shadcn also uses** (`--background`, `--primary`, `--muted`,
    `--input`, `--ring`, …). Tailwind hoists `index.css`'s `@layer base :root` *after*
    `tokens.css`, so the shadcn copy would win and every `var(--x)` would resolve to an HSL
    triplet — an invalid colour. This is why `.tbl-grid` gridlines use `--border2`, not `--border`.
15. **Respect reduced motion.** `@media (prefers-reduced-motion: reduce)` disables the
    `.dash-surface` / `.dash-cell` transitions.
