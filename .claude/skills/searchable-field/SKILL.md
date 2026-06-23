---
name: searchable-field
description: Trigger when a request says a select/dropdown field (SO, JWSO, JW, Vendor, item, client, or any master/document picker) should be searchable, autocomplete, typeable, type-to-search, filterable, or scrollable. Use this instead of hand-rolling a new dropdown/datalist/Picklist.
---

# Searchable field

The fix for "make this dropdown searchable / typeable / scrollable" is **always the same**:
reuse the one shared component. Do **not** build a new dropdown, `<datalist>`, or local
`Picklist`. Five+ forms duplicated that and each read as free-text, didn't scroll, and
matched only a prefix.

## The rule

Reuse `apps/web/src/components/shared/searchable-select.tsx` — `<SearchableSelect>`.

It already does: type-to-search input, dropdown opens on focus/click, scrollable
(max-h 16rem), case-insensitive substring match **anywhere** in the label (found by
starting OR ending chars), keyboard ArrowUp/Down + Enter + Esc, outside-click close,
`role=combobox/listbox` a11y, 250 ms debounce, "Loading…" / "No matches" states, and it
returns the picked row's **id** via `onChange` (never the label).

## How to wire it (3-line apply checklist)

1. Add a `const [xSearch, setXSearch] = useState('')` and call the entity's list hook with
   `{ search: xSearch || undefined, limit: 20-50, offset: 0 }`.
2. Render `<SearchableSelect value={id} onChange={setId} onSearch={setXSearch}
   loading={query.isFetching} options={items.map(r => ({ id, code, name }))} />`.
3. Keep storing the **same value** you stored before (usually the id). If the field
   stored a code-text snapshot, map on pick: `onChange={(id) => setCode(opts.find(o => o.id===id)?.code ?? '')}`
   and pass `valueLabel={currentCode}`.

`options` is `{ id, code?, name }[]`; it renders "CODE — Name". For one-row-per-line list
endpoints (job-work), dedupe to one entry per header id first.

## Hooks per entity

| Entity        | Hook (`apps/web/src/modules/...`)          | Response → option fields                          | search param |
| ------------- | ------------------------------------------ | -------------------------------------------------- | ------------ |
| Sales Order   | `sales-orders/api` → `useSalesOrdersList`  | `data.items[]` → `{ id, code, customerName }`       | `?search=`   |
| Vendor        | `vendors/api` → `useVendorsList`           | `data.vendors[]` → `{ id, code, name }`             | `?search=`   |
| JWSO / JW     | `job-work-orders/api` → `useJobWorkOrdersList` | `data.items[]` (one per line) → dedupe by `jwId` → `{ jwId, code, customerName }` | `?search=` (+ `status`) |
| Item          | `items/api` → `useItemsList`               | `data.items[]` → `{ id, code, name }`               | `?search=`   |
| Client        | `clients/api` → `useClientsList`           | `data.clients[]` → `{ id, code, name }`             | `?search=`   |

## Constraints (non-negotiable)

- **No new npm dependency** — Input primitive + Tailwind only.
- **No business-logic change** — identical saved value type (store the id, or the same
  code-text snapshot the field stored before).
- **Server-side search only** — wire `onSearch` to the endpoint's `?search=` param
  (these list endpoints support `?search=&limit=`). Never load all rows into the browser
  (`limit` ≤ 200). The component's client-side substring filter only refines the page the
  server already returned.

## Already applied (reference implementations)

`so-qc-status` (Select SO), `party-grn` (JWSO No), `service-pos` (Vendor + SO/JW No),
`nc-register` (SO No — code-text variant), `qc-documents` (Select SO). Copy any of these
when wiring a new field.
