# Innovic ERP: how to build with this kit

A dense manufacturing ERP for desktop (designed at 1440×810). Use these real components; never hand-make a table, pop-up, dropdown or button.

## Setup
Wrap everything in `DesignProvider` (DataTable and item images need it), and `ToastProvider` when a screen shows saved messages.

```jsx
<DesignProvider><ToastProvider>{screen}</ToastProvider></DesignProvider>
```

## Styling
Style with CSS variables from `styles.css`, never typed values.
- Text: `--fs-xs` 11px helper and labels, `--fs-sm` 13px reading text, `--fs-md` 16px panel titles, `--fs-lg` 22px page title.
- Spacing: `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 24. Corners: `--radius-sm`, `--radius`, `--radius2`.
- Colour: `--text`, `--text2`, `--text3`, `--bg`, `--bg2`, `--bg3`, `--bg4`, `--border`, `--blue`, `--red2`, `--green2`, `--amber2`.
- Existing classes: `.btn .btn-primary .btn-ghost .btn-sm`, `.panel`, `.innovic-input`, `.form-label`, `.req` (the red ★).

## Page patterns (one standard, every screen)
- **List:** `ListHeader` (title, count, search) → `Panel` + `DataTable` → `ListFooter`. No row of count or money tiles above a list; counts go in the Status filter or the footer's `summary`. Every row action sits in the ⋯ `RowMenu`.
- **Create / edit:** `PageHeader` (title, Back) → `Panel` with fields → `FormActions` as the page's last element, Cancel first and Save last. Save is ALWAYS at the bottom. A form with line items is a page; a small entry is a `Modal`.
- **Detail:** `DetailHeader` → `ClusterGrid stack` + `Cluster` + `ClusterFact` (label above value) → line table → `RelatedDocs` and History as tabs (`TabStrip`). The page scrolls. Print sits in the ⋯ menu.
- **Pop-up:** only `Modal`; a question is `ConfirmDialog`. Saved message = `useToast`, a lasting condition = `Banner`.

## Fixed looks
- Status always through `StatusBadge`: Cancelled red, Pending and Approved blue, QC Pending orange, Short Closed grey.
- Item codes dark, bold, monospace. Document numbers blue. Dates `03-11-2026`, times `02:35 PM`, whole quantities stay whole.
- Columns: text and codes left, Qty and counts centre, money right; dates, status, UOM, Sr No, POL and Rev centre. The heading aligns with its values, and an entry box follows its column. `DataTable` does this itself; never set alignment on a column or cell.
- Pickers from a master or document list use `SearchableSelect`; a short fixed list (status, type, UOM) uses `Select`. Required mark is the red ★. Empty lists read "No SOs yet."; with a filter on, "No SOs match."
- Action buttons use the drawn `Icon`. Emoji only identifies a page or module in its title.

## Example
```jsx
<ListHeader title="SO Master" icon="📋" count={128} noun="line" search="" onSearch={() => {}}
  primary={<Button variant="primary">+ New SO</Button>} />
```
Look at each component's `.prompt.md` and preview card for its props.
