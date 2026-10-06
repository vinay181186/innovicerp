// <PlanPicker> — the Plan field on the Create / Close Production Order screens.
// Same shape as components/shared/vendor-picker.tsx with the hook swapped:
// owns its search state, server-searched via /plans?search=, hands the caller
// the picked plan ROW (not just the id) so the screen can show its summary.
//
//   mode 'create' → plans with qty still to order (`poPending=true`, which
//                   since ADR-182 means Pending > 0 — a plan 20-covered of 50
//                   is still offered for the other 30). Each row prints
//                   Plan Qty · Pending.
//   mode 'close'  → route-card-driven plans that already HAVE one
//                   (`opsSource=route_card`, kept when productionOrderId is set)
//
// `bare` drops the picker's own label + error wrapper, for a screen that puts
// the box inside its own labelled cell (Create Production Order's Plan No.
// cell). `codeOnly` shows just the Plan No. in the box once a plan is picked —
// that screen's identity line already carries the item, SO line and POL — while
// the open list keeps the full option text.

import { useState } from 'react';
import { type SearchableOption, SearchableSelect } from '@/components/shared/searchable-select';
import { type PlanPickerItem, planPickerLabel, usePlanPickerList } from '../api';

export interface PlanPickerProps {
  id?: string | undefined;
  mode: 'create' | 'close';
  value: string | null;
  onChange: (plan: PlanPickerItem | null) => void;
  disabled?: boolean | undefined;
  labelText?: string | undefined;
  error?: string | undefined;
  /** What to print for `value` when the page set it (a deep link) rather than
   *  the dropdown, and the row is not on the current search page. */
  fallbackLabel?: string | undefined;
  /** No label / error wrapper — the caller's cell is the label. */
  bare?: boolean | undefined;
  /** The box shows only the picked Plan No.; the list is unchanged. */
  codeOnly?: boolean | undefined;
  /** Extra class on the picker's own wrapper (the shared searchable box). */
  className?: string | undefined;
}

export function PlanPicker({
  id = 'planId',
  mode,
  value,
  onChange,
  disabled = false,
  labelText = 'Plan',
  error,
  fallbackLabel,
  bare = false,
  codeOnly = false,
  className,
}: PlanPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = usePlanPickerList(
    mode === 'create'
      ? {
          poPending: true,
          ...(search.trim() ? { search: search.trim() } : {}),
          limit: 50,
          offset: 0,
        }
      : {
          // Plans with an OPEN Production Order — filtered on the server so an
          // old plan is never cut off by the page size.
          derivedStatus: 'in_production',
          ...(search.trim() ? { search: search.trim() } : {}),
          limit: 50,
          offset: 0,
        },
  );
  const items = data?.items ?? [];
  const plans = mode === 'close' ? items.filter((p) => p.productionOrderId !== null) : items;

  // Held separately so the picked plan still reads correctly once it scrolls
  // out of the current search page.
  const [label, setLabel] = useState('');
  const selected = plans.find((p) => p.id === value);
  const boxLabel = (p: PlanPickerItem): string => (codeOnly ? p.code : planPickerLabel(p, mode));

  const box = (
    <SearchableSelect
      id={id}
      className={className}
      value={value}
      onChange={(next) => {
        const p = plans.find((x) => x.id === next) ?? null;
        setLabel(p ? boxLabel(p) : '');
        onChange(p);
      }}
      {...(codeOnly ? { selectedLabel: (o: SearchableOption) => o.code ?? o.name } : {})}
      onSearch={setSearch}
      loading={isFetching}
      disabled={disabled}
      options={plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: planPickerLabel(p, mode).slice(p.code.length + 3),
        // POL (the CUSTOMER's own PO line number) is in the visible label, so
        // it has to be searchable alongside the PO and JC codes.
        searchText: [p.productionOrderCode, p.jcCode, p.clientPoLineNo].filter(Boolean).join(' '),
      }))}
      placeholder={
        mode === 'create'
          ? 'Search Plan No., Item Code or SO No.…'
          : 'Search Plan No., Production Order No., item or SO No.…'
      }
      valueLabel={selected ? boxLabel(selected) : label || fallbackLabel || undefined}
      emptyText={mode === 'create' ? 'No Plans with Pending qty.' : 'No Plans match.'}
    />
  );
  if (bare) return box;

  return (
    <div className="form-grp">
      <label className="form-label" htmlFor={id}>
        {labelText}
        <span className="req">★</span>
      </label>
      {box}
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
}
