---
name: styling
description: Innovic ERP table/row styling rules. Use whenever building or editing any list/master table (SO list, Items, Vendors, GRN, etc.) — keep short cell values like SO No., Date, codes, qty on ONE line (no wrapping), and make data rows clickable to open the detail page.
---

# Styling — Innovic ERP tables

How every list/master table in this app must look and behave. Apply these whenever
you add or edit a `innovic-table` (SO / WO Master, Items, Vendors, Clients, PO, GRN,
JWO, etc.). Reference implementation: `apps/web/src/modules/sales-orders/routes/list.tsx`.

## Rule 1 — Short cell values stay on ONE line (no word-splitting)

Values that are short labels — `SO No.`, `Date`, item codes, quantities, status,
`Raised By`, due dates — must never wrap onto a second line. A date like
`2026-06-19` or a code like `SO-0042` splitting across two rows looks broken.

**This is handled globally — you usually don't touch it.** `apps/web/src/styles/innovic-theme.css`
sets `white-space: nowrap` on both `.innovic-table th` and `.innovic-table td`, and
`.tbl-wrap` has `overflow-x: auto`, so any table built with the `innovic-table` class
keeps every cell on one line and scrolls sideways instead of wrapping. So: **build
tables with `<table className="innovic-table">` inside `<div className="tbl-wrap">`
and the no-wrap behavior comes for free.**

Only add a per-cell override when an element somehow escapes that (a custom table not
using `innovic-table`):

```tsx
<span className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
  {row.original.soDate}
</span>
```

**Exception — long free text** (Remarks, Customer name, addresses): do NOT force one
line. Those use the truncate-with-ellipsis pattern already in the SO list so a long
value is clipped, not wrapped:

```tsx
<span
  className="text3"
  style={{ maxWidth: 120, display: 'inline-block', overflow: 'hidden',
           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
  title={row.original.remarks ?? ''}   // full text on hover
>
  {row.original.remarks ?? ''}
</span>
```

So the difference: short values → plain `whiteSpace:'nowrap'` (let the column be as
wide as it needs). Long values → `nowrap` + fixed `maxWidth` + ellipsis + `title`.

## Rule 2 — Data rows are clickable (open the detail page)

The whole `<tr>` is a click target that navigates to that record's detail page.

```tsx
<tr
  onClick={() => void navigate({ to: '/sales-orders/$id', params: { id: row.original.id } })}
  style={{ cursor: 'pointer' }}
>
  {row.getVisibleCells().map((cell) => (
    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
  ))}
</tr>
```

`cursor: 'pointer'` is required so the hand cursor signals the row is clickable.

### Stop the click on interactive children

Any button, link, `<select>` filter, chevron, or 📎 icon INSIDE the row must call
`e.stopPropagation()` in its own `onClick`, otherwise clicking it also fires the row
navigation. Either on the control itself or on a wrapping element:

```tsx
// chevron / file / per-row action button:
<button onClick={(e) => { e.stopPropagation(); toggleExpand(row.original.id); }}>…</button>

// a group of actions — stop once on the wrapper:
<div onClick={(e) => e.stopPropagation()}>
  <Link to="/sales-orders/$id/edit" …>+ Line</Link>
  <button onClick={() => onDeleteSo(row.original)}>Del</button>
</div>

// header-cell filter dropdown:
<select onClick={(e) => e.stopPropagation()} onChange={…}>…</select>
```

A column rendered as a `<Link>` (e.g. the SO No.) already navigates on its own; it
doesn't need `stopPropagation` because it goes to the same detail page, but actions
that do something ELSE (edit, delete, expand, open file, change a filter) always do.

### Tell the user it's clickable

Keep the helper hint under the table so it's discoverable:

```tsx
<div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
  💡 Click a row to open it. Click the chevron to expand line items inline.
</div>
```

## Checklist before finishing a table

- [ ] Table uses `<div className="tbl-wrap"><table className="innovic-table">` (gives no-wrap + side-scroll for free).
- [ ] Long-text columns use the `maxWidth` + ellipsis + `title` pattern (not forced one line, not wrapping).
- [ ] `<tr>` has `onClick` → detail page and `cursor: 'pointer'`.
- [ ] Every in-row button / link-that-does-something-else / filter / chevron / icon calls `e.stopPropagation()`.
- [ ] The "click a row to open it" hint is present under the table.
