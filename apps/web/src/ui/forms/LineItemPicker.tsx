// LineItemPicker — the per-line "item cell" for document line editors (GRN,
// PO, …): Item Code (a native <datalist> over the Item Master) beside Item
// Name, where a code that matches the master auto-fills the name and locks it.
// Renders two .form-grp siblings, so place it inside a <FormGrid>.
//
// PHASE 2 SCOPE. This is the PRESENTATIONAL half of
// `@/components/shared/line-item-picker`, which is unchanged and still the one
// every screen imports today. That file cannot simply be re-exported from
// here: it calls `useItemsList` from `@/modules/items/api`, and ui/ must not
// depend on feature code. So the master rows arrive as an `items` prop instead
// of from a hook — which is also what lets the kit page render this with no
// fetch.
//
// Behaviour preserved verbatim from audit/02-element-inventory.md §D.3:
//   • a native <input list> + <datalist>, deliberately NOT SearchableSelect,
//     because this mirrors the long-standing PO line pattern;
//   • EXACT, case-insensitive code match only — never fuzzy;
//   • a match auto-fills the name, locks it read-only and paints it derived
//     (.is-derived), with the exact tooltip "Auto-filled from Item Master
//     (item code is the key)";
//   • a MISS clears itemId to null but LEAVES THE TYPED NAME ALONE — off-master
//     items are allowed here, deliberately unlike use-field-cascade's "a miss
//     resets everything";
//   • one useId() per instance for the datalist id, so many rows stay valid.
//
// PHASE 4: move this body into the live shared file and leave `useItemsList`
// there as a thin connected wrapper around it, so there is one markup, not two.

import { useId, useMemo } from 'react';
import { FormField, type FormFieldSize } from './FormField';
import { Input } from './Input';

/** Width on the 12-column FormGrid. */
export type LineItemPickerSize = FormFieldSize;

/** An Item Master row offered in the datalist. */
export interface LineItemOption {
  /** Item Master id. Reported back as `itemId` on a match. */
  id?: string | undefined;
  /** The unique, permanent item code — the key this picker matches on. */
  code: string;
  name: string;
  material?: string | null | undefined;
}

/** What the picker reports after any code or name edit. */
export interface LineItemPickerValue {
  code: string;
  /** Resolved Item Master id when the code matched, else null. */
  itemId: string | null;
  name: string;
  /** True when `code` matched an Item Master row exactly. */
  matched: boolean;
}

export interface LineItemPickerProps {
  /** Current item code text for the line (the unique key). */
  code: string;
  /** Current item name. Derived + read-only while the code matches the master. */
  name?: string | undefined;
  /** Item Master rows to offer. Hand it the caller's already-loaded page. */
  items?: readonly LineItemOption[] | undefined;
  /** When true (e.g. a QC-locked GRN line), both inputs are read-only. */
  readOnly?: boolean | undefined;
  /** Validation message rendered under the name input. */
  nameError?: string | undefined;
  /** Widths on the 12-column grid. Defaults match the design reference. */
  codeSize?: LineItemPickerSize | undefined;
  nameSize?: LineItemPickerSize | undefined;
  /** Receives the resolved line refs after any code or name edit. */
  onChange: (next: LineItemPickerValue) => void;
}

const EMPTY_ITEMS: readonly LineItemOption[] = [];

export function LineItemPicker({
  code,
  name = '',
  items = EMPTY_ITEMS,
  readOnly = false,
  nameError,
  codeSize = 'md',
  nameSize = 'lg',
  onChange,
}: LineItemPickerProps): React.JSX.Element {
  const itemsByCode = useMemo(() => {
    const m = new Map<string, LineItemOption>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  // Unique per instance — a line editor mounts one of these per row, and a
  // shared datalist id would make the DOM invalid and cross-wire the lists.
  const uid = useId();
  const listId = `${uid}-items`;
  const codeId = `${uid}-code`;
  const nameId = `${uid}-name`;

  const matchedItem = itemsByCode.get(code.trim().toUpperCase());
  const nameLocked = readOnly || Boolean(matchedItem);

  function handleCodeChange(nextCode: string): void {
    const match = itemsByCode.get(nextCode.trim().toUpperCase());
    if (match) {
      onChange({ code: nextCode, itemId: match.id ?? null, name: match.name, matched: true });
    } else {
      // Off-master free text: the id goes, the typed name stays.
      onChange({ code: nextCode, itemId: null, name, matched: false });
    }
  }

  return (
    <>
      <FormField label="Item Code" size={codeSize} htmlFor={codeId}>
        <Input
          id={codeId}
          list={listId}
          autoComplete="off"
          readOnly={readOnly}
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
        />
        <datalist id={listId}>
          {items.map((it) => (
            <option key={it.id ?? it.code} value={it.code}>
              {it.code} — {it.name}
              {it.material ? ` [${it.material}]` : ''}
            </option>
          ))}
        </datalist>
      </FormField>
      {/* Rule: a code that is on the Item Master makes the name derived and
          read-only (the item code is the key); off-master it stays editable. */}
      <FormField
        label="Item Name"
        required
        size={nameSize}
        htmlFor={nameId}
        error={nameError ?? undefined}
      >
        <Input
          id={nameId}
          state={matchedItem ? 'derived' : undefined}
          autoComplete="off"
          readOnly={nameLocked}
          title={matchedItem ? 'Auto-filled from Item Master (item code is the key)' : undefined}
          value={name}
          onChange={(e) =>
            onChange({
              // A hand-typed name is an OFF-MASTER name, so the line carries no
              // master id: matched:false and a non-null itemId would be two
              // halves of the contract contradicting each other. (Only
              // reachable when nothing matched — a match locks this input.)
              code,
              itemId: null,
              name: e.target.value,
              matched: false,
            })
          }
        />
      </FormField>
    </>
  );
}
