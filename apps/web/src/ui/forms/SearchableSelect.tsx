// SearchableSelect — the one type-to-search picker for every master/document
// field (SO, JWSO, vendor, item, client…). Rows read "CODE — Name".
//
// PHASE 2 SCOPE: this is a THIN WRAPPER over the live implementation at
// `@/components/shared/searchable-select`. That component carries load-bearing
// behaviour catalogued in audit/02-element-inventory.md §D.1 — a document.body
// portal for the listbox, capture-phase scroll / resize / mousedown listeners,
// an exactly-250ms search debounce, the above/below flip, the full combobox
// aria wiring, "typing clears the saved id", and the two-way `valueLabel`
// sync. None of it is touched here.
//
// What this wrapper adds, all of it outside the state machine:
//   • `onSearch` becomes OPTIONAL, so the kit page — and any caller with a
//     fixed in-memory list — can render the picker in every state with no data
//     fetch. Omitting it means "no server search"; the client-side substring
//     refine inside the live component still filters the options it was given.
//   • `style`, from the design-ref API, applied to a wrapper element only.
//
// STILL TO DO IN PHASE 4 — it cannot be done from out here, because it means
// editing the live file: that component still renders its box through the
// stale shadcn `Input` and paints its listbox with Tailwind utilities. The
// design-ref skin (`.innovic-input` plus `.ss-list` / `.ss-opt` / `.ss-opt.hl`
// / `.ss-muted`, all of which already exist in innovic-theme.css) cannot be
// applied from a wrapper: those classNames are internal, and the list is
// portaled to <body>, so no ancestor selector reaches it either.

import {
  SearchableSelect as LiveSearchableSelect,
  type SearchableOption as LiveSearchableOption,
} from '@/components/shared/searchable-select';

/** A row in the picker. Rendered as "CODE — Name" when `code` is present. */
export type SearchableOption = LiveSearchableOption;

export interface SearchableSelectProps {
  /** The selected option id (the saved value), or null. */
  value: string | null;
  /** Called with the picked option id — never the label — or null when cleared. */
  onChange: (id: string | null) => void;
  /** Current page of options from the caller's list hook (already server-filtered). */
  options: SearchableOption[];
  /**
   * Receives the debounced (250 ms) search term; wire it to the list hook's
   * ?search= param. Omit for a fixed in-memory list.
   */
  onSearch?: ((term: string) => void) | undefined;
  /** True while the caller's list hook is fetching. */
  loading?: boolean | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** Label for an already-selected `value` — edit forms, where the saved row
   *  may sit beyond the first options page. */
  valueLabel?: string | undefined;
  /** What to show in the box once a row is picked. Default "CODE — Name". */
  selectedLabel?: ((o: SearchableOption) => string) | undefined;
  id?: string | undefined;
  className?: string | undefined;
  emptyText?: string | undefined;
  /** Applied to a wrapper around the control (design-ref API). */
  style?: React.CSSProperties | undefined;
}

/** Stable identity. The live component re-syncs the caller's search term on
 *  open through an effect keyed on `onSearch`, so a fresh inline arrow every
 *  render would re-fire that effect on every render while the list is open. */
const NO_SEARCH = (): void => {};

export function SearchableSelect({
  value,
  onChange,
  options,
  onSearch,
  loading,
  placeholder,
  disabled,
  valueLabel,
  selectedLabel,
  id,
  className,
  emptyText,
  style,
}: SearchableSelectProps): React.JSX.Element {
  const control = (
    <LiveSearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      onSearch={onSearch ?? NO_SEARCH}
      loading={loading}
      placeholder={placeholder}
      disabled={disabled}
      valueLabel={valueLabel}
      selectedLabel={selectedLabel}
      id={id}
      className={className}
      emptyText={emptyText}
    />
  );
  // Only wrap when there is something to put on the wrapper. The extra node
  // does not affect the portal — that measures its own inner container — but
  // there is no reason to emit one for nothing.
  //
  // `position: relative` first, as design-ref/components/forms/SearchableSelect.jsx:12
  // does, so a caller passing top / left / transform offsets the control the
  // same way here as in the reference. A caller that wants something else
  // still overrides it: `style` is spread after.
  return style ? <div style={{ position: 'relative', ...style }}>{control}</div> : control;
}
