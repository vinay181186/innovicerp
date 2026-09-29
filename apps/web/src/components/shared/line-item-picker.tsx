// <LineItemPicker> — one reusable per-line "item cell" for document line editors
// (GRN, PO, …). It renders the item-code input (a <datalist> over the Item Master)
// plus the item-name input, and enforces the system item-code rule uniformly:
//
//   • Item code is the unique key. Typing a code that EXISTLY matches an Item Master
//     code auto-fills the name and makes it READ-ONLY (derived, not typed).
//   • Off-master free text keeps the name editable and clears itemId (null).
//
// Presentational + controlled: the caller owns the line state and passes
// { code, itemId, itemName }, receiving the resolved { code, itemId, name } back via
// onChange. The component reuses the shared item-master hook (useItemsList) so a single
// query is deduped across every row by TanStack Query's cache. Mirrors the long-standing
// PO line pattern (purchase-order-form.tsx) so the rule reads identically everywhere.

import { useEffect, useId, useRef } from 'react';
import { findItemByExactCode, useItemCodeSearch } from '@/modules/items/use-item-code-search';

export interface LineItemPickerValue {
  code: string;
  itemId: string | null;
  name: string;
}

export interface LineItemPickerProps {
  /** Current item code text for the line (the unique key). */
  code: string;
  /** Resolved Item Master id when the code matches, else null. */
  itemId: string | null;
  /** Current item name. Read-only + auto-filled when the code matches the master. */
  itemName?: string | undefined;
  /** When true (e.g. a QC-locked GRN line), both inputs are read-only. */
  readOnly?: boolean | undefined;
  /** Optional validation message rendered under the name input. */
  nameError?: string | undefined;
  /** Receives the resolved line refs after any code/name edit. */
  onChange: (next: LineItemPickerValue) => void;
}

export function LineItemPicker({
  code,
  itemId,
  itemName = '',
  readOnly = false,
  nameError,
  onChange,
}: LineItemPickerProps): React.JSX.Element {
  // Item master drives the code autosuggest + name auto-fill, searched on the
  // SERVER with the typed code (it used to be one preloaded page of 1000, so a
  // later item could neither be suggested nor auto-filled). Off-master free text
  // is left untouched (itemId null).
  // ADR-195: GRN/PO buying/receiving lines must not offer the customer's own material.
  const { items, match: matchedItem } = useItemCodeSearch(code, { excludePartyOwned: true });

  // The server's exact match can arrive after the keystroke that typed the code.
  // Link it then, exactly as a match at type-time would — but only for a code
  // the user typed in this session, never for a saved line on load.
  const typedRef = useRef(false);
  useEffect(() => {
    if (readOnly || !typedRef.current || !matchedItem || matchedItem.id === itemId) return;
    onChange({ code, itemId: matchedItem.id, name: matchedItem.name });
  }, [readOnly, matchedItem, itemId, code, onChange]);

  // Unique datalist id per instance — keeps the DOM valid when many rows mount.
  const dlId = useId();
  const nameLocked = readOnly || Boolean(matchedItem);

  const handleCodeChange = (nextCode: string): void => {
    typedRef.current = true;
    const match = findItemByExactCode(items, nextCode);
    if (match) {
      onChange({ code: nextCode, itemId: match.id, name: match.name });
    } else {
      onChange({ code: nextCode, itemId: null, name: itemName });
    }
  };

  return (
    <>
      <div className="form-grp">
        <label className="form-label">Item Code</label>
        <input
          className="innovic-input"
          list={dlId}
          autoComplete="off"
          readOnly={readOnly}
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
        />
        <datalist id={dlId}>
          {items.map((it) => (
            <option key={it.id} value={it.code}>
              {it.code} — {it.name}
              {it.material ? ` [${it.material}]` : ''}
            </option>
          ))}
        </datalist>
      </div>
      {/* Rule: when the code is on the Item Master the name is derived + read-only
          (item code is the key); off-master the name stays editable. */}
      <div className="form-grp">
        <label className="form-label">
          Item Name<span className="req">★</span>
        </label>
        <input
          className="innovic-input"
          autoComplete="off"
          readOnly={nameLocked}
          style={matchedItem ? { background: 'var(--bg4)', color: 'var(--text3)' } : undefined}
          value={itemName}
          onChange={(e) => onChange({ code, itemId, name: e.target.value })}
        />
        {nameError ? <div className="form-error">{nameError}</div> : null}
      </div>
    </>
  );
}
