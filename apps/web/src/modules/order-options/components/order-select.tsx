// <OrderSelect> — the one SO / JWSO dropdown (owner 2026-11-04). Rows read
// `IN-SO-00009 · SO-100 — Customer`; the box shows only `IN-SO-00009 · SO-100`.
// Client PO No. is searchable but never shown. The × is a separate button
// outside the box, so it can also clear typed text and a filter with no pick.

import type { OrderOption, QcDossierOrderKind } from '@innovic/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { soNoWithInternal } from '@/lib/so-number';
import { SearchableSelect, type SearchableOption } from '@/ui/forms';
import { useOrderOptions, type OrderOptionsArgs } from '../api';

const DEFAULT_PLACEHOLDER = {
  so: 'All SOs — type SO, Client PO, customer…',
  jwso: 'All JWSOs — type JWSO, Client PO, customer…',
  both: 'All SOs / JWSOs — type No., Client PO, customer…',
} as const;

const NOUN = { so: 'SO', jwso: 'JWSO', both: 'SO or JWSO' } as const;
const CLEAR_LABEL = { so: 'Clear SO', jwso: 'Clear JWSO', both: 'Clear SO / JWSO' } as const;

const orderLabel = (o: OrderOption): string => soNoWithInternal(o.code, o.internalSoNo);
const boxLabel = (o: SearchableOption): string => o.code ?? o.name;

export interface OrderSelectProps {
  /** The picked order's code (IN-SO-##### / IN-JW-#####), or null. */
  value: string | null;
  onChange: (option: OrderOption | null) => void;
  /** Leave out for both SOs and JWSOs. */
  kind?: QcDossierOrderKind | undefined;
  cancelled?: OrderOptionsArgs['cancelled'];
  placeholder?: string | undefined;
  id?: string | undefined;
  /** Keeps the × active though nothing is picked (several ticked in a column ▾). */
  extraActive?: boolean | undefined;
}

export function OrderSelect({
  value,
  onChange,
  kind,
  cancelled,
  placeholder,
  id,
  extraActive = false,
}: OrderSelectProps): React.JSX.Element {
  const [term, setTerm] = useState('');
  // SearchableSelect keeps its own typed text; a new key is the only way to
  // empty it from outside.
  const [resetKey, setResetKey] = useState(0);
  // The picked row may leave the options once the search changes.
  const pickedRef = useRef<OrderOption | null>(null);

  // A value restored after a refresh is searched for, so it resolves to its full label.
  // Nothing is read until the box is opened or holds a value.
  const [asked, setAsked] = useState(false);
  const query = useOrderOptions({ search: term || value || '', kind, cancelled }, asked || !!value);
  const orders = useMemo(() => query.data?.orders ?? [], [query.data?.orders]);
  const options = useMemo(
    () =>
      orders.map((o) => ({
        id: o.code,
        code: orderLabel(o),
        name: o.customerName ?? '',
        // The server also matched Client PO No.; keep that row through the box's own filter.
        searchText: o.clientPoNo,
      })),
    [orders],
  );

  const current =
    orders.find((o) => o.code === value) ??
    (pickedRef.current?.code === value ? pickedRef.current : null);
  const valueLabel = value ? (current ? orderLabel(current) : value) : undefined;

  // Opening the box sends what it shows. The picked label is not a search term
  // (it joins two fields), so a re-opened box asks for the picked order instead.
  const labelRef = useRef(valueLabel);
  labelRef.current = valueLabel;
  const handleSearch = useCallback((t: string): void => {
    setAsked(true);
    setTerm(t === labelRef.current ? '' : t);
  }, []);

  function handleChange(code: string | null): void {
    if (code === null) {
      pickedRef.current = null;
      onChange(null);
      return;
    }
    const picked = orders.find((o) => o.code === code);
    if (!picked) return;
    pickedRef.current = picked;
    setTerm('');
    onChange(picked);
  }

  function clear(): void {
    pickedRef.current = null;
    setResetKey((k) => k + 1);
    setTerm('');
    onChange(null);
  }

  const noun = NOUN[kind ?? 'both'];
  const canClear = !!value || term.trim() !== '' || extraActive;

  return (
    <div className="order-filter">
      <SearchableSelect
        key={resetKey}
        id={id}
        className="order-filter-box"
        ariaLabel={kind === 'so' ? 'SO' : kind === 'jwso' ? 'JWSO' : 'SO / JWSO'}
        value={value}
        valueLabel={valueLabel}
        selectedLabel={boxLabel}
        onChange={handleChange}
        onSearch={handleSearch}
        options={options}
        loading={query.isFetching}
        error={query.error}
        emptyText={term ? `No ${noun} matches "${term}".` : `No ${noun} yet.`}
        placeholder={placeholder ?? DEFAULT_PLACEHOLDER[kind ?? 'both']}
      />
      <button
        type="button"
        className="order-filter-clear"
        aria-label={CLEAR_LABEL[kind ?? 'both']}
        title={CLEAR_LABEL[kind ?? 'both']}
        disabled={!canClear}
        onClick={clear}
      >
        ×
      </button>
    </div>
  );
}
