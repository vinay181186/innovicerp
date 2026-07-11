---
name: dropdown
description: How the Innovic ERP type-to-search dropdown (the "Client★ (type to search)" style field) works and behaves. Read this whenever building, editing, debugging, or explaining any type-to-search / autocomplete / combobox dropdown — what opens it, how typing filters, keyboard nav, selection, and the states it shows. For the "just make this field searchable, don't hand-roll one" wiring steps, use the searchable-field skill instead.
---

# Dropdown — how the type-to-search dropdown works

Every "pick a master/document" field in this app (Client, SO, JWSO, Vendor, Item, …)
is the **same** type-to-search dropdown. It is the single shared component
`apps/web/src/components/shared/searchable-select.tsx` → `<SearchableSelect>`.
Reference field: **`CLIENT★ (type to search)`** on the New Sales Order form
(`apps/web/src/modules/sales-orders/components/sales-order-form.tsx`).

> Building a NEW searchable field? First read the **`searchable-field`** skill — the
> rule is *reuse this component, never hand-roll a `<datalist>`/`Picklist`*. THIS skill
> explains the internal behavior: what the dropdown does and why, for editing,
> debugging, or explaining it.

## What the user sees (the reference field)

```
CLIENT★ (TYPE TO SEARCH)
┌────────────────────────────────────────┐
│ 🔍  Type client code or name…          │   ← input (role=combobox)
├────────────────────────────────────────┤
│ 543 — Nilkanth engineering             │   ← highlighted row (bg=accent)
│ CL_952 — Madhuban industries           │
│ CLC_1 — krishna enterprise             │   ← each row = "CODE — Name"
│ CLI-001 — kisan                        │      CODE bold, "— Name" muted
│ CLI-002 — jinal industries             │
│ CLI-DEMO — Demo Engineering Works      │
└────────────────────────────────────────┘   ← listbox: max-h 16rem, scrolls
```

## How it works — behavior, step by step

**1. Opening.** The dropdown opens on **focus, click, or ArrowDown** (`onFocus`,
`onClick` → `setOpen(true)`). No separate caret button — the whole input is the trigger.
When closed and a value is already picked, the input shows that value's label
(`valueLabel`), so the field reads as "filled", not empty.

**2. Typing → search.** Each keystroke:
   - updates the visible `query` string,
   - **invalidates any prior selection** — if a row was picked, `onChange(null)` fires so
     the saved id clears (you must re-pick; prevents a stale id under new text),
   - **debounces 250 ms**, then calls `onSearch(term)`. The caller wires `onSearch` to the
     list hook's `?search=` param, so the **server** returns the matching page (this is
     what scales past the 200-row cap — never load the whole table into the browser).

**3. Filtering (two layers).**
   - *Server:* returns rows for the typed term via `?search=`.
   - *Client refinement:* a case-insensitive **substring** match **anywhere** in the
     `"CODE — Name"` label — so a row is found by its **starting OR ending** characters
     (typing `industries` finds `CLI-002 — jinal industries`). This only refines the page
     the server already returned; it is not the primary filter.

**4. Keyboard navigation.**
   | Key        | Effect                                                        |
   | ---------- | ------------------------------------------------------------ |
   | ArrowDown  | open if closed; move highlight down (clamped to last row)    |
   | ArrowUp    | move highlight up (clamped to first row)                     |
   | Enter      | pick the highlighted row (only when open + a row exists)     |
   | Escape     | close the dropdown (keeps current value)                     |
   The highlight index resets to 0 whenever the filtered list length changes.

**5. Selecting.** Click (`onMouseDown`, preventDefault so the input keeps focus) or Enter:
   - calls `onChange(option.id)` — **always the row's `id`, never the label text**,
   - sets the input to the picked label (default `"CODE — Name"`, or a custom
     `selectedLabel`, e.g. code-only),
   - closes the dropdown.

**6. Closing.** Escape, picking a row, or an **outside mousedown** (a document listener
closes it when you click anywhere outside the component).

**7. States shown in the list.**
   - `loading` → **"Loading…"** row (while the hook is fetching),
   - zero rows → **"No matches"** (override via `emptyText`),
   - otherwise the rows, `"CODE — Name"` with CODE bold and name muted; a row with no
     `code` renders just the name.

## The contract (props that drive the behavior)

`<SearchableSelect>` is **presentational** — it owns none of the data. The caller owns the
list hook + a `search` state string. Key props:

| Prop            | Role                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `value`         | the selected option **id** (the saved value), or `null`                 |
| `onChange(id)`  | fires with the picked **id** (or `null` when typing clears a selection) |
| `options`       | current page from the hook: `{ id, code?, name }[]` (server-filtered)   |
| `onSearch(term)`| debounced term → wire to the hook's `?search=` param                    |
| `loading`       | hook `isFetching` → shows the "Loading…" row                            |
| `valueLabel`    | label for a pre-selected `value` (edit forms) so it shows when closed   |
| `selectedLabel` | what the input shows after a pick (default `"CODE — Name"`)             |
| `placeholder` / `emptyText` | input placeholder / empty-list text                         |

Reference wiring (the Client field):

```tsx
const [clientSearch, setClientSearch] = useState('');
const { data: clientsData, isFetching } = useClientsList({
  ...(clientSearch.trim() ? { search: clientSearch.trim() } : {}),
  limit: 50, offset: 0,
});

<SearchableSelect
  id="clientId"
  value={selectedClientId}
  onChange={(id) => setClientId(id)}
  onSearch={setClientSearch}
  loading={isFetching}
  options={clients.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
  placeholder="🔍 Type client code or name…"
  valueLabel={selectedClient ? `${selectedClient.code} — ${selectedClient.name}` : undefined}
/>
```

## Accessibility (already built in)

`role="combobox"` on the input with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`,
and `aria-activedescendant` pointing at the highlighted option; the list is `role="listbox"`
with `role="option"` + `aria-selected` rows. Don't re-implement these.

## When debugging one of these fields, check in order

- **Nothing appears when typing** → is `onSearch` wired to the hook's `?search=` param, and
  is the hook actually re-fetching on `search` change? (250 ms debounce is expected.)
- **Saved value is wrong / stores the text** → `onChange` must persist the **id**, not the
  label. Typing after a pick clears the id by design — the user must re-pick.
- **Picked value doesn't show on an edit form** → pass `valueLabel` for the pre-selected id.
- **Only prefix matches** → you hand-rolled a `<datalist>`; replace with `<SearchableSelect>`
  (it substring-matches anywhere). See the `searchable-field` skill.
- **List won't scroll / loads everything** → server-side search with `limit` ≤ 200; the
  list is `max-h-64` and scrolls. Never load the whole table client-side.

## Non-negotiables

- **No new npm dependency** — built on the `Input` primitive + Tailwind only.
- **Server-side search** — `onSearch` → `?search=`, `limit` ≤ 200.
- **Store the id** (or the exact same code-text snapshot the field stored before) — the
  dropdown never changes the saved value's type.
- **Don't hand-roll another dropdown.** One component, one behavior, fixes land everywhere.
