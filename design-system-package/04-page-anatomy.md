# 04 — Page Anatomy: the three reference screens

These three screens ARE the Innovic ERP house style. Anything new must be assembled
from the regions, classes and tokens documented here. Everything below is read out of
the source; where the code does not set a value it says **not specified in code**
(inherited from `02-innovic-theme.css` / `01-tokens.css`).

Source files:

| Screen | File(s) |
| --- | --- |
| Job Cards LIST | `apps/web/src/modules/job-cards/routes/list.tsx` (1037 lines) |
| Job Card DETAIL | `routes/status.tsx` → `components/jc-status-content.tsx` → `components/jc-status-view.tsx` + `jc-view-summary.tsx` + `jc-stat-tiles.tsx` + `jc-view-tabs.tsx` |
| Purchase Orders LIST | `apps/web/src/modules/purchase-orders/routes/list.tsx` (548) + `components/po-sheet-table.tsx` (218) |

Shared: `@/components/shared/stat-strip`, `@/components/shared/item-badge`,
`@/components/shared/searchable-select`, `@/components/shared/file-preview-modal`.

---

## 0. Global density metrics (the numbers every screen inherits)

Tokens (`01-tokens.css`):

| Token | Value | Used for |
| --- | --- | --- |
| `--fs-body` | `14px` | body |
| `--fs-control` | `13px` | `.btn`, `.innovic-input`, `.innovic-select`, `.innovic-table td` |
| `--fs-label` | `11px` | `.btn-sm`, `.form-label`, `.stat-sub` |
| `--fs-mono` | `11px` | `.badge`, `.innovic-table th` (base variant) |
| `--fs-heading` | `17px` | — |
| `--fs-section` | `22px` | `.section-hdr` |
| `--fs-stat` | `28px` | `.stat-val` |
| `--hfont` | `'Barlow Condensed', sans-serif` | headings, panel titles, sheet `th` |
| `--bfont` | `'Barlow', sans-serif` | body, buttons, inputs |
| `--mono` | `'Source Code Pro', monospace` | `.mono`, `.td-code`, `.badge` |
| `--radius-sm / --radius / --radius2` | `4px / 6px / 8px` | badges / buttons+inputs / panels |
| `--bg / --bg2 / --bg3 / --bg4 / --bg5` | `#f5f7fa / #ffffff / #f8fafc / #f2f4f7 / #eaecf0` | page / panel / header band / hover / track |
| `--border / --border2 / --border3` | `#d8e1ec / #c8d3e0 / #b3c1d1` | hairline / gridline / visible grey |
| `--text / --text2 / --text3` | `#172b4d / #667085 / #7b8aa0` | value / secondary / caption |
| `--blue` `--blue2` `--blue3` | `#155eef / #123b73 / #eff6ff` | codes, primary btn, sheet header |
| `--green/2/3` `--amber/2/3` `--red/2/3` `--purple/2/3` `--cyan` `--teal2/3` | see tokens | status tones |

Chrome heights: `.btn` `padding: 7px 12px` + 1px border ≈ 32px, deliberately equal to
`.innovic-input` (`padding: 7px 10px`) so a filter row lines up. `.btn-sm` = `4px 10px`
/ `--fs-label`. `.btn-icon` = `6px 8px`.

Panels: `.panel` = `var(--bg2)` + `1px solid var(--border)` + `--radius2` +
`margin-bottom: 10px`, `overflow: hidden`. `.panel-hdr` = `8px 14px` on `var(--bg3)`.
`.panel-body` = `padding: 12px`.

Table (`.innovic-table`): `th` `6px 10px`, uppercase, `letter-spacing .08em`, centred,
`position: sticky; top: 0`. `td` `6px 10px`, `--fs-control`, `white-space: nowrap`.
Sheet variant `.tbl-grid` overrides: `table-layout: fixed`, `border-top/bottom: 2px solid var(--blue2)`,
`th` = `--hfont` 800 `11px` on `var(--bg4)` in `var(--blue2)` with `border-right: 1px solid var(--border2)`,
`td` = `13px`, `padding 8px 8px`, gridlines both sides, `text-align: center`,
`white-space: normal; overflow-wrap: anywhere`, odd rows `#fffbf2` (cream) / even `var(--bg2)`,
hover `var(--bg4)`.

**Every table in the app centres header AND values** — enforced once by the
`.innovic-table th, .innovic-table td { text-align: center }` block. A column that must
be left-aligned writes `style={{ textAlign: 'left' }}` on BOTH its `<th>` and `<td>`
(inline is the only thing that beats it).

---

## 1. Job Cards LIST

### 1.1 Purpose + route

Plan, track and manage manufacturing jobs. Read-only list with row actions.

```ts
export const jobCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards',
  validateSearch: listSearchSchema,
  component: JobCardsListPage,
});
```

Search params (`listSearchSchema`, zod): `search?`, `status?` (`JC_COMPUTED_STATUSES`),
`machineId?` (uuid), `operatorId?` (uuid), `fromDate?` `toDate?` (`^\d{4}-\d{2}-\d{2}$`),
`page` (coerced int, default `1`). Every filter mutation calls
`navigate({ search: prev => ({...prev, ...update, page: 1}), replace: true })` — deep
linkable, back-button clean, never pushes history.

Data: one fetch, `LIST_LIMIT = 200`, `offset: 0`; `PAGE_SIZE = 200` client-side paging.
View mode (`'list' | 'card'`) persisted in `localStorage` under `VIEW_STORAGE_KEY = 'jc-list-view'`,
read inside `try/catch`, default `'list'`.

### 1.2 Region-by-region, top to bottom

**A. Frozen header band** — wraps header row + KPI strip + filter panel:

```jsx
style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)',
         paddingBottom: 8, marginBottom: 10, borderBottom: '1px solid var(--border)' }}
```

Background must be opaque `var(--bg)`; it is not bled edge-to-edge (that would give the
app a horizontal scrollbar).

**B. Page header row** — `display:flex; justifyContent:space-between; alignItems:'flex-start'; marginBottom:12; gap:8`.

- Left: `<div className="section-hdr" style={{ marginBottom: 2 }}>Job Cards</div>`
  then `<div className="text3" style={{ fontSize: 12 }}>Plan, track and manage manufacturing jobs</div>`.
- Right (`display:flex; alignItems:center; gap:8`), in order:
  1. background-refetch pill, only when `isFetching && !isLoading`:
     `<span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>` +
     `<Loader2 className="inline h-3 w-3 animate-spin" /> Updating…`
  2. `<Link to="/planning" className="btn btn-primary">+ Plan &amp; Create Job Card</Link>`
  3. `<Link to="/job-cards/new" className="btn btn-ghost" title="Job Work Sales Orders (JWSO) only. Sales Order items are created via Planning.">+ New JWSO Job Card</Link>`

  Both gated on `canWrite = effectiveFormPerms(eff, 'jc_create').entry`.

**C. KPI strip** — ONE `<StatStrip>` inside `<div style={{ marginBottom: 10 }}>`. Six
items, computed from the **loaded/filtered rows**, not global:

| key | label | colour | rule |
| --- | --- | --- | --- |
| `total` | `Total Job Cards` | `var(--cyan)` | `rows.length` |
| `open` | `Open` | `var(--amber)` | not done, no ops done |
| `in_progress` | `In Progress` | `var(--blue)` | `doneOps > 0 \|\| status==='qc_pending' \|\| runningCount > 0` |
| `on_hold` | `On Hold` | `var(--text3)` | always `0`; `title="No hold state exists in job-card data — see report"` |
| `completed` | `Completed` | `var(--green)` | `complete` or `closed` |
| `overdue` | `Overdue` | `var(--red)` | `!isDone && dueDate < today` |

No `onClick` / `to` on these items → each cell renders as a plain `<div>`, **not**
announced as a control. Under the strip:
`<div className="text3" style={{ fontSize: 10, marginTop: 4 }}>Counts reflect the currently loaded / filtered list, not every job card in the system.</div>`

StatStrip internals (the house KPI row): container `className="panel"` with
`display:flex; flexWrap:wrap; padding:0; overflow:hidden`. Each cell:
`flex:'1 1 140px'`, `minWidth:120`, `textAlign:'left'`, `padding:'8px 16px'`,
`borderLeft: i===0 ? 'none' : '1px solid var(--border)'`,
`borderBottom: 2px solid <color|transparent>` for the active state. Label = `fontSize:10;
fontWeight:700; textTransform:uppercase; letterSpacing:'0.06em'`, `var(--text3)` or the
stat colour when active. Number = `className="mono fw-700"`, `fontSize:22; lineHeight:1.15`.
Optional `sub` = `className="text3"` `fontSize:11`. Interactive cells are real
`<button aria-pressed>` (filters) or `<Link className="dash-link dash-cell">` (navigation).
**Active state is a coloured underline + coloured label, never a ring or a box.**

**D. Filter panel** — `<div className="panel" style={{ marginBottom: 0 }}>` →
`<div className="panel-body" style={{ padding: '10px 14px' }}>`, two stacked rows.

Row 1 (`flex; flexWrap:wrap; gap:8; alignItems:center; marginBottom:8`), left→right:

| # | Control | class | width / size | text |
| --- | --- | --- | --- | --- |
| 1 | text input (debounced 300ms → `?search=`) | `innovic-input` | `width: 320, fontSize: 12` | placeholder `Search JC no., item code / name, customer, SO no.…` |
| 2 | status select | `innovic-select` | `width: 180, fontSize: 12` | `All statuses` + `JC_COMPUTED_STATUSES` with `_`→space |
| 3 | `<span style={{ flex: 1 }} />` spacer | — | — | — |
| 4 | List/Card toggle, `display:flex; gap:4` | `` `btn btn-sm ${view==='list' ? 'btn-primary':'btn-ghost'}` `` | — | `List View` / `Card View`, `aria-pressed` |

Row 2 — `display:grid; gridTemplateColumns:'repeat(4, minmax(0, 1fr))'; gap:8`, all
`fontSize: 12`:

| # | Control | class | options / type |
| --- | --- | --- | --- |
| 1 | machine select | `innovic-select` | `All machines` + `{code} — {name}` |
| 2 | operator select | `innovic-select` | `All operators` + `{code} — {name}` |
| 3 | from date | `innovic-input` `type="date"` | `placeholder="From date"` |
| 4 | to date | `innovic-input` `type="date"` | `placeholder="To date"` |

Search debounce uses the shared `normalizeSearchTerm(searchInput)` so `"  IN-JC  26 "`
and `"IN-JC 26"` are one query, one cache entry, one URL.

**E. Body** — mutually exclusive branches, in this order:

1. `isLoading` → `<div className="panel"><div className="empty-state" style={{ padding: 20 }}><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading job cards…</div></div>`
2. `isError` → same shell, `style={{ padding: 20, color: 'var(--red)' }}`, message = `error.message` else `Failed to load job cards`
3. `rows.length === 0` → same shell, text `No job cards match these filters.`
4. `view === 'list'` → the sheet table (§1.3)
5. else → Card View (one `.panel` per JC, 4px accent bar, `QtyBox` strip)

Access guard (before anything renders):
`if (eff && !effectiveFormPerms(eff,'jc_create').view)` →
`<div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>⛔ This page is hidden for your access. Ask an admin if you need access to it.</div>`

**F. Footer** — under the table:

- tip line: `<div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>💡 Click a row to open the job card.</div>`
- count/pager bar: `flex; justifyContent:space-between; alignItems:center; marginTop:8; fontSize:12; color:'var(--text3)'`.
  Left text: `Showing first 200 of {total} — refine with search` when `total > LIST_LIMIT`,
  else `Showing {a}–{b} of {n} job card(s)`.
  Right, only when `totalPages > 1`: `‹ Prev` / `<span className="mono">Page {n} of {m}</span>` / `Next ›`,
  both `className="btn btn-ghost btn-sm"` with `disabled` at the ends.

### 1.3 Table spec — `<table className="innovic-table tbl-grid">` inside `<div className="tbl-wrap" style={{ overflowX: 'hidden' }}>`

`<colgroup>` widths sum to 100% so the sheet never scrolls sideways.

| # | Header | Width | Renders | Align | Font treatment | Truncation | Clickable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `Sr No` | `4%` | `(page-1)*PAGE_SIZE + i + 1` | centre | `className="text3"` | — | row only |
| 2 | `Job Card No.` | `11%` | `<Link className="td-code" style={{color:'var(--blue)',fontWeight:800}}>` `{jc.code}`, plus 2nd line `Rev. {itemRevision}` (`className="mono"`, `fontSize:9`, `var(--text3)`) | centre | mono 13px fw-800 blue | — | **yes**, `title="View job card status"`, `onClick={e=>e.stopPropagation()}` |
| 3 | `Thumbnail` (`<ItemThumbnailHeader/>`) | `THUMBNAIL_COL_WIDTH = '8%'` | `<ItemThumbnailCell imagePath alt>` — product image fills the cell edge-to-edge (`td padding:0; position:relative; height:40`) | — | — | `object-fit: cover` | **yes** → opens `FilePreviewModal`, stops propagation |
| 4 | `Part / Description` | `12%` | `<ItemBadge size="row" showImage={false} code name revision style={{display:'flex',width:'100%'}} />` | **left** (`style={{textAlign:'left'}}` on th AND td) | code `mono fw-700` `var(--purple)` 12px; name `text2` 11px | code+name `nowrap + ellipsis + title`, name `maxWidth 200` | no |
| 5 | `SO No.` | `9%` | `<Link className="mono" style={{fontSize:11,color:'var(--blue)',textDecoration:'none'}}>` to `/sales-orders/$id` or `/job-work-orders/$id`; `/lineNo` suffix at `fontSize:9` when `lineNo !== 1`; else `<span className="text3">—</span>` | centre | mono 11px blue | — | **yes**, stops propagation |
| 6 | `Qty (Plan)` | `6%` | `<span className="mono fw-700">{orderQty}</span>` + `<span className="text3" style={{fontSize:10}}>Nos</span>` | centre | mono fw-700 | one line | no |
| 7 | `Progress` | `8%` | 80×4 track `background:'var(--bg5)'; borderRadius:2` with `var(--green)` fill at `{pct}%`, caption `{done} / {orderQty} · {pct}%` (`className="mono"`, 9px, `var(--text3)`) | centre | mono 9px | `minWidth: 80` | no |
| 8 | `Status` | `8%` | `<JcStatusBadge status={computedStatus}/>` → `badge b-grey\|b-amber\|b-cyan\|b-green\|b-red`, labels `open / qc pending / complete / closed / no ops` | centre | `.badge` mono 11px 700 uppercase | nowrap | no |
| 9 | `Start Date` | `7%` | `{jc.jcDate}` | centre | `className="mono" style={{fontSize:11}}` | — | no |
| 10 | `Due Date` | `7%` | `{dueDate ?? '—'}`; optional 2nd line `Disp {customerDispatchDate}` (`className="text3"`, `fontSize:11`, `whiteSpace:'nowrap'`, `title="Customer Dispatch Date (from the plan)"`) | centre | mono 11px | nowrap | no |
| 11 | `Days Left` | `5%` | `<span className="mono fw-700" style={{color: dColor}}>` — `—` when done/no due; `<0` red, `≤5` amber, else green; `var(--text3)` when null | centre | mono fw-700, tone-coloured | — | no |
| 12 | `Action` | `15%` | see below | centre, `td style={{ padding: '8px 2px' }}` | — | `flexWrap:'nowrap'` | buttons only |

**Row click target** — the whole `<tr>`:

```jsx
<tr key={jc.id}
    onClick={() => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
    style={{ cursor: 'pointer' }}>
```

**Action column** — one row of six icon-only buttons, centred, wrapped in a
stopPropagation div:

```jsx
<div className="jc-row-acts"
     style={{ display:'flex', gap:4, justifyContent:'center', flexWrap:'nowrap' }}
     onClick={(e) => e.stopPropagation()}>
```

| Order | Control | class | icon | title / aria-label | gate |
| --- | --- | --- | --- | --- | --- |
| 1 | `<Link to="/job-cards/$id">` | `btn btn-ghost btn-sm btn-icon` + `style={{padding:'2px 3px'}}` | `<Eye size={13}/>` | `View` | — |
| 2 | `<PrintJcButton iconOnly/>` | `btn btn-ghost btn-sm btn-icon` | `<Printer size={13}/>` | `Print` | — |
| 3 | `<ExcelJcButton iconOnly/>` | `btn btn-ghost btn-sm btn-icon` | `<Download size={13}/>` | `Download Excel` | — |
| 4–5 | `<JcRowWriteActions iconOnly/>` | Edit `btn btn-ghost btn-sm btn-icon` (`<Pencil size={13}/>`), Delete `btn btn-danger btn-sm btn-icon` (`<Trash2 size={13}/>`), confirm step = `<Check size={13}/>` / `<X size={13}/>` | | `Edit` / `Delete` / `Confirm delete` / `Cancel` | self-gated inside |
| 6 | `<AssignTaskButton className="btn btn-ghost btn-sm btn-icon" label="" />` | ↑ | `👤+` | — | self-gated inside |

CSS that makes this fit: `.innovic-table.tbl-grid td:last-child .jc-row-acts .btn-sm`
= `inline-flex; gap:4; padding:2px 6px; height:24px; white-space:nowrap`.

### 1.4 Interaction rules

- Row click → `/job-cards/$id`. Every in-cell link and the whole action block call
  `e.stopPropagation()`.
- Hover: `.innovic-table.tbl-grid tbody tr:hover td { background: var(--bg4) }`.
- No client-side sort. `.innovic-table th` carries `cursor: pointer` + `:hover { color: var(--cyan) }`
  from the base theme, but this list wires no sort handler — **not specified in code**.
- Sticky: `th { position: sticky; top: 0; z-index: 5 }` (base rule) and the whole header
  band is `position: sticky; top: 0; z-index: 20`. No frozen first column here
  (`.tbl-frozen` is not applied).
- `.tbl-wrap` is `overflow-x/y: auto; max-height: calc(100vh - 220px)`; this list
  overrides `overflowX: 'hidden'`.
- Deep links: any combination of the six search params above, e.g.
  `/job-cards?status=qc_pending&machineId=…&fromDate=2026-09-01&page=2`.

---

## 2. Job Card DETAIL (JC Status)

### 2.1 Purpose + route

Deep-linkable, shareable read-only status screen for one job card (legacy `viewJCStatus`
was a modal).

```ts
export const jobCardStatusRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id',
  component: JobCardStatusPage,
});
```

No `validateSearch` → **no search params**. `routes/status.tsx` is a 35-line wrapper: the
"hide page" guard (identical amber `⛔ This page is hidden…` panel) then
`<JcStatusContent id={id} />`, which dispatches VIEW (`jc-status-view.tsx`) vs EDIT
(`jc-status-content.tsx`). VIEW is the reference layout.

### 2.2 Region-by-region (letters as the source comments label them)

**A. Header bar** — `display:flex; alignItems:center; gap:10; flexWrap:wrap; marginBottom:12`.

| Order | Element | class / style | text |
| --- | --- | --- | --- |
| 1 | title | `className="section-hdr" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}` with the code in `<span className="mono" style={{ color: 'var(--text)' }}>` | `Job Card : {jc.code}` |
| 2 | status | `<JcStatusBadge status={jc.computedStatus}/>` | — |
| 3 | spacer | `<span style={{ flex: 1 }} />` | — |
| 4 | back | `btn btn-ghost btn-sm` + `<ArrowLeft size={14}/>` | `Back to List` → `/job-cards` |
| 5 | print | `btn btn-ghost btn-sm`, `disabled={opsLoading}`, `<Printer size={13}/>` | `Print Job Card` |
| 6 | excel | `btn btn-ghost btn-sm`, `<Download size={13}/>`, `title="Download Excel (with production log)"` | `Excel` |
| 7 | **primary** | `btn btn-primary btn-sm` | `▶ Production Entry` → `/op-entry?jc={code}` |
| 8 | edit | `btn btn-ghost btn-sm` + `<Pencil size={14}/>`, gated `effectiveFormPerms(eff,'jc_create').edit` | `Edit Job Card` |

Note: on a detail page the action cluster sits at the **right end of the title row**, all
`btn-sm`, icon **plus** label (lists are icon-only; detail pages are labelled).

**B. Recovery banner** — `<RecoveryBanner jc={jc}/>`, renders null on an ordinary card.

**C. Header tile** — `<JcViewSummary>`: one `<div className="panel" style={{ marginBottom: 12 }}>`
→ `<div className="panel-body" style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-start', padding:'10px 14px' }}>`
with four flex columns (responsive with no media query — the flex-bases sum under 1240px
so a 1280px laptop keeps one line):

| Col | `flex` | Contents |
| --- | --- | --- |
| 1 Product | `'0 1 280px'` | `<ItemBadge size="tile" codeColor="var(--text)" nameMaxWidth="none">` (120px picture, `object-fit: contain`, 8px padding, `boxShadow 0 1px 3px rgba(20,40,70,0.08)`), children = `Material:` / `Size:` rows (`fontSize:12.5`, label `var(--text3)`, value `mono fw-700` + ellipsis + `title`); then `👁 Open drawing` (`btn btn-ghost btn-sm`) and, for image drawings, a thumbnail button (`border:1px solid var(--border2)`, `borderRadius:8`, `img maxHeight:56, maxWidth:116`) |
| 2 References | `'1 1 230px'` | 2-col grid `gridTemplateColumns:'auto minmax(0, 1fr)'; columnGap:12; rowGap:4; alignItems:'baseline'`. `Kv` pairs: label `{fontSize:12, color:'var(--text3)', whiteSpace:'nowrap'}`, value `{fontSize:12.5, fontWeight:600, color:'var(--text)'}`. Rows: `Drawing`, `SO No. / Line` (or `JW No. / Line`), `Route Card` (+ `badge b-grey` `Rev n`), `Prod. Order` (+ `· POL n` in `mono fw-700` `var(--purple)`), conditional `Parent JC`, conditional `Child JC` (each with `badge b-amber` `REWORK` / `badge b-blue` `REPAIR`). Code links: `className="mono fw-700"` + `codeLink = {color:'var(--blue)', textDecoration:'none', fontSize:12}` |
| 3 KPI tiles | `'1.5 1 400px'` | `display:grid; gridTemplateColumns:'repeat(auto-fit, minmax(72px, 1fr))'; gap:6` — 5 across, folds to 3/2 |
| 4 Meta | `'0 0 auto'` | 2-col grid `'auto auto'; columnGap:10; rowGap:4`, values right-aligned |

`KpiTile` (the detail-page tile — distinct from StatStrip): `border: 1px solid <tone>;
borderRadius: 7; padding: '6px 8px'; textAlign:'center'`, number `className="mono"`
`fontSize:18; fontWeight:800; lineHeight:1.1`, caption `fontSize:9.5; color:var(--text3);
marginTop:2; textTransform:uppercase; letterSpacing:'.05em'; whiteSpace:'nowrap'`.
Tones map `plain→var(--bg2)/var(--border)/var(--text)`, `green→var(--green3)/var(--green)`,
`blue→var(--blue3)/var(--blue)`, `red→var(--red3)/var(--red)`, `amber→var(--amber3)/var(--amber)`.

The five tiles, in order: `Order Qty` (plain), `Completed` (green), `WIP` (blue),
`Rejected (NC)` (red), `Pending` (amber when `>0`, else green). Each carries an
explanatory `title`. Derived values show `'—'`, never `0`, while `opsLoaded === false`.
Optional line under the grid: `RM avail <n> of <m> issued` (`fontSize:11.5`, red+700 when 0).

Column 4 rows, each label in `kvLabel` and value `className="fw-700"` `fontSize:12.5`
`whiteSpace:'nowrap'` `textAlign:'right'`: `Due Date` (`📅`), `Customer Dispatch` (`🚚`),
`Priority` (`badge b-amber` `↑ High` / `badge b-grey` `Normal`), `Overall Status`
(`JcStatusBadge`), `Waiting at` (`Op{srNo} · {QC|Outsource|machineCode}`, plus
`· running on <amber label>` when the actual machine differs, or
`<span style={{color:'var(--green)'}}>All operations complete</span>`).

**D. Route / Operation Flow** — `<div className="panel" style={{ marginBottom: 12 }}>` with a
`<SectionBar title="Route / Operation Flow">` and, when open,
`<div className="panel-body" style={{ padding: '12px 16px' }}>` holding `<JcOpFlowCards>`.

`SectionBar` = `<div className="panel-hdr" style={{ borderBottom: open ? '1px solid var(--border)' : 'none' }}>`
with a `<button className="panel-title">` stripped to `background:none; border:none; padding:0`,
`fontSize:15; color:'var(--blue2)'`, prefixed by `▾`/`▸` at `fontSize:10; color:var(--text3)`;
optional `right` slot `display:flex; alignItems:center; gap:10`.

`JcOpFlowCards`: wrapping strip, `flexWrap:'wrap'; alignItems:'stretch'; rowGap:8`.
Every card is the SAME fixed size — `flex:'0 0 150px'; width:150; height:92;
border: 1.5px solid <tone>; borderRadius:8; padding:'7px 10px'` — four stacked lines:
1. `OP{srNo}` (+ ` · QC` / ` · OSP`) — `className="mono"` `fontSize:11; fontWeight:800; var(--text3)`
2. machine / `QC` / `OUTSOURCE` — `className="fw-700"` `fontSize:13`, nowrap+ellipsis+`title`
3. operation name — `fontSize:12`, nowrap+ellipsis+`title`
4. `✓ 15/15 · ♻2` — `className="mono fw-700"` `fontSize:12`, `marginTop:'auto'` (pinned bottom)

Status changes **only** colours, never size: done → `var(--green2)` border / `var(--green3)`
fill / green qty; current → `var(--amber)` / `var(--amber3)`; else `var(--border)` / `var(--bg2)`.
Separator between cards: `flex:'0 0 20px'` `→` in `var(--border3)` `fontSize:16`, `aria-hidden`.
The strip WRAPS — no horizontal scroll.

**E. Operations Details** — `<div className="panel" style={{ marginBottom: 12 }}>` with a
`SectionBar title="Operations Details"` whose `right` slot holds a checkbox label
`Show All Operations Expanded` (`display:inline-flex; gap:6; fontSize:12; color:var(--text2)`)
and `<button className="btn btn-ghost btn-sm">` reading `⤢ Expand All` / `⤡ Collapse All`.
Body `<div style={{ padding: '2px 0' }}>` renders `<JcOpCard>` per op, or
`<div className="empty-state">No operations</div>`.
Default expansion = the current op (lowest-seq not complete) **and** the next one; on a
finished card, the last op.

**F. Tab bar** — `<div className="panel">` with
`<div role="tablist" style={{ display:'flex', gap:2, padding:'0 8px', borderBottom:'1px solid var(--border)', background:'var(--bg3)' }}>`.
Tabs in order: `Documents & Quality` · `Remarks` · `Related Records` · `History`.
Each is a `<button role="tab" aria-selected>` with
`background:none; border:none; borderBottom: 2px solid ${active ? 'var(--blue)' : 'transparent'};
padding:'9px 12px'; fontSize:12; fontWeight:700; color: active ? 'var(--blue2)' : 'var(--text2)'`.
Body = `<div className="panel-body">`. **Same underline-not-box active idiom as StatStrip.**

History tab body: a per-date grouped icon feed (not a table) inside
`maxHeight:320; overflowY:'auto'; border:1px solid var(--border); borderRadius:8; padding:'0 12px'`,
headed by `{n} entries` / `showing latest {n} of {total} entries` in `fontSize:11 var(--text3)`.
Empty: `<div className="empty-state" style={{ padding: 16 }}>No log entries yet</div>`.
Remarks empty: `No remarks on this job card`.

### 2.3 Loading / error / empty

- Loading: `<div className="empty-state"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…</div>`
- Error / not found: `<div className="empty-state" style={{ color: 'var(--red)' }}>{message || 'Job card not found'}</div>`
- Hidden page: the shared amber `⛔` panel.

### 2.4 Interaction rules

- No sticky region on the detail page; the whole page scrolls.
- Every collapsible section keeps its own `useState` (`flowOpen`, `detailOpen`), default open.
- The item picture and the drawing thumbnail both open the shared `FilePreviewModal`
  and `stopPropagation` so they never trigger an ancestor's click.
- Outbound links: SO/JW (`/sales-orders/$id`, `/job-work-orders/$id`), Route Card
  (`/route-cards?search={code}` — list-with-search, because the card carries only the code),
  Production Order, Parent/Child JC, Op Entry (`/op-entry?jc={code}&op={id}&mode=start|complete`),
  QC (`/qc-call-register?search={jcCode}`).

### 2.5 The EDIT-mode summary (`JcStatTiles`) — same vocabulary, different container

Used by the EDIT page only. One rounded card, `background: var(--bg2); border: 1px solid
var(--border); borderRadius: var(--radius2); padding: 16; marginBottom: 16`, three rows:
(1) four info groups in `repeat(auto-fit, minmax(210px, 1fr))` gap 16 — `Item` / `SO / WO` /
`Quantity (pcs)` / `Overall Status`, each headed by `lblStyle` = `fontSize:10; fontWeight:700;
color:var(--text3); textTransform:uppercase; letterSpacing:'.07em'; marginBottom:6`;
(2) `Route Progress` using `<div className="prog-wrap" style={{height:8}}><div className="prog-bar" style={{width:`${pct}%`, background:'var(--blue)'}}/></div>`;
(3) `Operation Flow` chips (`JcOpFlowChips`, `minWidth:80` chips with a `›` separator).
Quantity is ONE segmented control (`QtySeg`), not three cards:
`display:flex; border:1px solid var(--border2); borderRadius:8; overflow:hidden`,
numbers `mono` `fontSize:18` (emphasised `20`) `fontWeight:800`, captions `fontSize:9` uppercase.

---

## 3. Purchase Orders LIST

### 3.1 Purpose + route

Vendor purchase orders, ported from legacy `renderPurchaseOrders`.

```ts
export const purchaseOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders',
  validateSearch: listSearchSchema,   // search?, status?, poType?, page (default 1)
  component: PurchaseOrdersListPage,
});
```

`LIST_LIMIT = 200`, no server pagination (one fetch, scroll).
`VIEW_STORAGE_KEY = 'po-list-view'`, same `try/catch` localStorage pattern, default `'list'`.

### 3.2 Region-by-region

**A. Frozen header band** — byte-identical style object to the JC list:
`position:'sticky'; top:0; zIndex:20; background:'var(--bg)'; paddingBottom:8; marginBottom:10; borderBottom:'1px solid var(--border)'`.

**B. Page header row** — ONE row (no sub-caption, no separate filter panel):
`display:flex; justifyContent:'space-between'; alignItems:'center'; gap:8`.

- Left: `<div className="section-hdr" style={{ marginBottom: 0 }}>🛒 Purchase Orders</div>`
- Right cluster `display:flex; alignItems:center; gap:8`, left→right:

| # | Control | class | width | text |
| --- | --- | --- | --- | --- |
| 1 | search input (300ms debounce) | `innovic-input` | `width: 240, fontSize: 12` | placeholder `🔍 Search this list…` (deliberately generic — the API matches PO code, PR ref, vendor code/name, status, type, date and line item code/name) |
| 2 | status select | `innovic-select` | `width: 140, fontSize: 12` | `All statuses` + `PO_STATUSES` |
| 3 | type select | `innovic-select` | `width: 140, fontSize: 12` | `All types` + `PO_TYPES` |
| 4 | refetch pill | `text3`, `fontSize: 11, fontFamily: 'var(--mono)'` | — | `<Loader2 className="inline h-3 w-3 animate-spin" /> Updating…` |
| 5 | primary action | `btn btn-primary` | — | `<Plus size={14} /> New PO` → `/purchase-orders/from-pr`, gated `perms.entry` |
| 6 | view toggle | `` `btn btn-sm ${view==='list'?'btn-primary':'btn-ghost'}` `` | — | `List View` / `Card View` |

**C. No KPI strip.** Deliberate — legacy's stat-card filter row was not ported
(see `docs/ISSUES.md` ISSUE-030). Instead, an **active-filter chip row** below the band,
rendered only when `search.status || search.poType`:

```jsx
<div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, fontSize:12 }}>
  <span className="text3">Filtered: <span className="amber" style={{ fontWeight: 700 }}>{activeFilter}</span></span>
  <button type="button" className="btn btn-ghost btn-sm">Show All</button>
</div>
```

`activeFilter` = the set filters joined with `, `, `_` replaced by spaces.

**D. Body** — same four-branch ladder as the JC list, same `panel`+`empty-state` shells.
Texts differ: `Loading…`, `Failed to load purchase orders`, `No purchase orders yet`.

**E. Footer** — always rendered (outside the branch):
`display:flex; justifyContent:'flex-end'; alignItems:'center'; marginTop:8; fontSize:12; color:'var(--text3)'`
→ `No purchase orders` / `Showing first 200 of {total} — refine with search` /
`Showing all {total} purchase order(s)`. **No pager.**

### 3.3 Table spec — `PoSheetTable`, `<table className="innovic-table tbl-grid">` inside `<div className="tbl-wrap" style={{ overflowX: 'hidden' }}>`

Column order follows legacy L25350-25355. `<colgroup>` sums to 100%.

| # | Header | Width | Renders | Align | Font treatment | Truncation | Clickable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `Sr No` | `4%` | `i + 1` | centre | `className="text3"` | — | row only |
| 2 | `PO No.` | `11%` | `<Link className="td-code" style={{color:'var(--blue)',fontWeight:800,fontSize:13}}>{po.code}</Link>` + 2nd line `{po.poDate}` (`className="mono"`, `fontSize:11`, `var(--text3)`) | centre | mono 13px fw-800 blue | — | **yes**, `title="Open the PO detail page"`, stops propagation |
| 3 | `Type` | `5%` | `` `badge ${isJW ? 'b-amber' : isSvc ? 'b-teal' : 'b-blue'}` `` showing `JW` / `SVC` / `MAT` | centre | `.badge` mono 11px 700 uppercase | nowrap | no |
| 4 | `Vendor` | `16%` | `<span className="fw-700" style={{display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={vendor}>` — `vendorName ?? vendorCodeText ?? '—'` | **left** (`textAlign:'left'` on th AND td) | fw-700, body font | ellipsis + `title` | no |
| 5 | `PR Ref` | `10%` | `<span className="mono" style={{color:'var(--purple)',fontWeight:700,fontSize:12}}>{prCodeText ?? '—'}</span>` | centre | mono 700 purple 12px | — | no |
| 6 | `Lines` | `5%` | `{po.lineCount}` | centre | `className="mono"` | — | no |
| 7 | `Total Qty` | `7%` | `<span className="mono fw-700">{totalQty}</span>` | centre | mono fw-700 | — | no |
| 8 | `Received` | `7%` | `mono fw-700`, `color: receivedQty > 0 ? 'var(--green)' : 'var(--text3)'` | centre | mono fw-700, tone | — | no |
| 9 | `Pending` | `7%` | `mono fw-700`, `color: pending > 0 ? 'var(--amber)' : 'var(--green)'` | centre | mono fw-700, tone | — | no |
| 10 | `Value` | `7%` | `<span className="mono">₹{Math.round(v).toLocaleString('en-IN')}</span>`; `null` (prices hidden for this viewer) → `<span className="text3">—</span>` | centre | mono | — | no |
| 11 | `Status` | `7%` | `<PoStatusBadge>` → `b-grey` draft/cancelled, `b-blue` open, `b-amber` partial/qc_pending, `b-green` closed; label = status with `_`→space | centre | `.badge` | nowrap | no |
| 12 | `Action` | `14%` | 2×2 grid, see below | centre | — | — | buttons only |

**Row click target** — `<tr key={po.id} onClick={() => onOpen(po.id)} style={{ cursor: 'pointer' }}>`,
where `onOpen` is `(id) => navigate({ to: '/purchase-orders/$id', params: { id } })` passed
down from the route.

**Action column** — a 2×2 grid inside a stopPropagation wrapper (contrast with the JC
list's single icon row):

```jsx
<div className="jc-row-acts"
     style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:3 }}
     onClick={(e) => e.stopPropagation()}>
```

| Order | Control | class | label | gate |
| --- | --- | --- | --- | --- |
| 1 | `<Link to="/purchase-orders/$id">` | `btn btn-primary btn-sm` | `👁 View` | — |
| 2 | `<Link to="/purchase-orders/$id/edit">` | `btn btn-ghost btn-sm` | `✎ Edit` | `canEdit && status !== 'closed'` |
| 3 | `<Link to="/delivery-challans/new" search={{ poId }}>` | `btn btn-ghost btn-sm` | `📦 DC` | `canEdit && poSendsMaterialOut(poType) && status !== 'draft'` |
| 4 | `<AssignTaskButton>` | `btn btn-ghost btn-sm` (default) | `👤+ Assign` | `status !== 'closed' && status !== 'cancelled'` |

The `.innovic-table.tbl-grid .jc-row-acts .btn-sm` rule (`inline-flex`, `height:24px`,
`padding 2px 6px`) makes each button fill its grid cell so the block reads as one tidy panel.

Footer tip inside `PoSheetTable`:
`<div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>💡 Click a row to open the purchase order.</div>`

### 3.4 Interaction rules

- Row click → `/purchase-orders/$id`; action grid stops propagation.
- Hover = `var(--bg4)` via `.tbl-grid tbody tr:hover td`.
- No sort, no frozen column, no pager — **not specified in code** beyond the base theme.
- Deep links: `/purchase-orders?search=…&status=open&poType=job_work`.
- Permissions: `perms = effectiveFormPerms(eff, 'po_create')`; `canAdd = perms.entry`
  (New PO), `canEdit = perms.edit` (Edit, Create DC), `perms.view` (whole page).

---

## 4. Patterns these three screens establish

A new screen is "in house style" only if it follows all of these.

**Page shell**

1. **Page header = `section-hdr` on the left, action buttons on the right**, in one
   `justify-content: space-between` flex row. The title may carry a leading emoji
   (`🛒 Purchase Orders`) and an optional `className="text3" fontSize:12` sub-caption.
2. **Exactly one primary action per page**, `className="btn btn-primary"`, at the right
   end. Everything else in that cluster is `btn btn-ghost`. On detail pages the whole
   cluster is `btn-sm`.
3. **A list's header band is sticky**: `position:'sticky'; top:0; zIndex:20;
   background:'var(--bg)'; paddingBottom:8; marginBottom:10; borderBottom:'1px solid var(--border)'`.
   Opaque background is mandatory; never bleed it edge-to-edge.
4. **Background refetch is a text pill, not a spinner overlay**:
   `className="text3"`, `fontSize:11`, `fontFamily:'var(--mono)'`, `<Loader2 … animate-spin /> Updating…`,
   shown only when `isFetching && !isLoading`.
5. **Every page opens with the access guard** before any markup:
   `if (eff && !effectiveFormPerms(eff, '<form_key>').view) return <div className="empty-state" style={{ color:'var(--amber)', padding:40 }}>⛔ This page is hidden for your access. …</div>`.

**KPI counts**

6. **Counts are ONE `<StatStrip>` row inside ONE `.panel` — never N separate cards.**
   Cells separated by a single `1px solid var(--border)` left hairline, active state =
   coloured label + `2px` coloured bottom border. Never a ring, never a box.
7. A stat with no `onClick`/`to` renders as a `<div>`, not a dead button. A filtering
   stat is a `<button aria-pressed>`; a navigating one is a `<Link className="dash-link dash-cell">`
   so middle-click and ctrl-click work.
8. If counts are computed from the loaded page rather than the whole table, **say so**
   in a `text3` `fontSize:10` line under the strip.

**Filters and search**

9. One debounced (300ms) text input driving `?search=`, always passed through
   `normalizeSearchTerm`. Placeholder either names the fields
   (`Search JC no., item code / name, customer, SO no.…`) or stays generic
   (`🔍 Search this list…`) — never a stale column list.
10. Every filter writes to the URL with `replace: true` and resets `page: 1`. Filter
    state lives in `validateSearch` zod, so every view is deep-linkable.
11. Filter controls are `innovic-input` / `innovic-select` at `fontSize: 12` with explicit
    pixel widths (320/240 search, 180/140 selects) or a `repeat(4, minmax(0,1fr))` grid.
12. A List/Card toggle is two `btn btn-sm` buttons, active one `btn-primary`, inactive
    `btn-ghost`, with `aria-pressed`; the choice is remembered per browser in
    `localStorage` inside `try/catch`.

**Tables**

13. The sheet is always `<div className="tbl-wrap"><table className="innovic-table tbl-grid">`
    with a `<colgroup>` of percentages that **sum to 100%**, plus `overflowX: 'hidden'` —
    no horizontal scroll, ever.
14. Column 1 is `Sr No` (`className="text3"`); the last column is `Action`. A list with
    images puts a `Thumbnail` column immediately **before** the item code · name column
    (`THUMBNAIL_COL_WIDTH = '8%'`, picture fills the cell).
15. **Codes render strong**: `className="td-code"` + `color: 'var(--blue)'` + `fontWeight: 800`
    for the document number, `mono fw-700` for every other code, `var(--purple)` for item
    and reference codes. Never `var(--text3)` for a code — that token is for captions only.
16. **Every header and value is centred**; a column that must be left-aligned writes
    `style={{ textAlign: 'left' }}` on both the `<th>` and the `<td>` (Part/Description, Vendor).
17. **Short values never wrap**: dates, qty, codes, badges use `mono` and stay one line.
    **Long text truncates**: `overflow:hidden; textOverflow:'ellipsis'; whiteSpace:'nowrap'`
    plus a `title` holding the full string.
18. Secondary facts go on a **second line inside the same cell** (`Rev. B`, the PO date,
    `Disp <date>`) at `fontSize: 9–11` in `var(--text3)` — never a new column, which would
    break the 100% width budget.
19. **Data rows are clickable** and open the detail page:
    `onClick={() => navigate({ to: '…/$id', params: { id } })}` + `style={{ cursor: 'pointer' }}`.
    A `💡 Click a row to open the <thing>.` hint line (`fontSize:11`, `var(--text3)`, `marginTop:6`)
    sits under the table.
20. **Every in-cell link and the whole action block wrap `onClick={(e) => e.stopPropagation()}`.**
21. Action buttons in a list are `btn btn-ghost btn-sm` (+ `btn-icon` when icon-only),
    with `title` AND `aria-label` naming the action. Icon size `13`. Destructive =
    `btn-danger` with a two-step confirm (`Check` / `X`). Detail pages use the same
    buttons **with labels**.
22. Tone colouring is always token-based and always on the value, never the cell:
    over-due/negative `var(--red)`, near-due/outstanding `var(--amber)`, done `var(--green)`,
    absent `var(--text3)` rendered as `—`.

**Status, badges, progress**

23. Status is a `<XStatusBadge>` component mapping the enum to `badge b-*` — never an
    ad-hoc coloured span. Labels are the raw enum with `_` replaced by a space.
24. A progress bar is an 80–90px × 4px track (`background: 'var(--bg5)'`, `borderRadius: 2`)
    with a `var(--green)` fill, captioned `{done} / {total} · {pct}%` in `mono` `fontSize: 9`
    `var(--text3)`. Panel-scale bars use `.prog-wrap` / `.prog-bar`.

**Detail pages**

25. Structure is: header bar → optional banner → **one summary panel** → collapsible
    section panels → a tab bar panel. Each panel is `.panel` with `marginBottom: 12`.
26. Summary panels are ONE panel with internal flex/grid columns carrying `flex-basis`
    values (`'0 1 280px'`, `'1 1 230px'`, `'1.5 1 400px'`, `'0 0 auto'`) that sum under
    1240px — **responsive without a media query or a `<style>` tag**.
27. Detail KPI tiles are `repeat(auto-fit, minmax(72px, 1fr))`, fixed size, tinted by tone
    (`--x3` background, `--x` border and number). Size never changes with status — only colour.
28. Key/value pairs use a 2-column grid `'auto minmax(0, 1fr)'` with the label at
    `fontSize:12 var(--text3) nowrap` and the value at `fontSize:12.5 fontWeight:600 var(--text)`.
29. Collapsible sections use `SectionBar` inside `.panel-hdr`: a `▾`/`▸` toggle button
    styled `.panel-title` at `fontSize:15 var(--blue2)`, with an optional right slot.
30. Tabs are `role="tablist"` buttons on `var(--bg3)` with a `2px solid var(--blue)` bottom
    border when active — the **same underline idiom** as the StatStrip's active cell.
31. A derived number that is not yet loaded renders `'—'`, never `0`. Every non-obvious
    figure carries a `title` explaining how it was computed.

**Loading / error / empty**

32. All three states are `<div className="panel"><div className="empty-state" style={{ padding: 20 }}>…</div></div>`
    in the order loading → error → empty → content. Loading shows
    `<Loader2 className="mr-2 inline h-4 w-4 animate-spin" />` + `Loading <things>…`;
    error adds `color: 'var(--red)'` and prints `error.message` with a typed fallback;
    empty is a plain sentence (`No job cards match these filters.`, `No purchase orders yet`).
33. Footer count line: `flex`, `fontSize: 12`, `color: 'var(--text3)'`, reading
    `Showing first 200 of {total} — refine with search` when capped, else
    `Showing all {n} <thing>(s)`. A pager, when present, sits at the right of that same row
    as `‹ Prev` / `<span className="mono">Page n of m</span>` / `Next ›` in `btn btn-ghost btn-sm`.

**Hard rules**

34. **Tokens only. No hard-coded hex** in component code (the one exception already in
    the theme is the sheet's cream `#fffbf2`).
35. Reuse the shared components — `StatStrip`, `ItemBadge` / `ItemThumbnailCell` /
    `ItemThumbnailHeader`, `SearchableSelect`, `FilePreviewModal`, the `*StatusBadge`
    family — instead of re-implementing their look. An item is shown ONE way: picture
    box + `CODE/REV` in `mono fw-700` + quiet name.
36. Files stay under 400 lines; a list over that splits its table into
    `components/<x>-sheet-table.tsx` (as `po-sheet-table.tsx` did) rather than growing the route.
