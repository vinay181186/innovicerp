// ADR-290 — Customer Part No. and Replacement Item on the Item Master form
// (create and edit share this). Customer Part No. is the customer's own number
// for the part (may differ from our Item Code). Replacement Item is the item
// that replaces this one after a change that is not interchangeable — picked
// from the Item Master, never the item itself (the server checks it too).

import { useMemo, useState } from 'react';
import { FormField, Input, SearchableSelect, type SearchableOption } from '@/ui/forms';
import { useItemsList } from '../api';

export function ItemPartFields({
  customerPartNo,
  onCustomerPartNo,
  replacementItemId,
  replacementItemCode,
  onReplacementItem,
  selfId,
}: {
  customerPartNo: string | null | undefined;
  onCustomerPartNo: (v: string | null) => void;
  replacementItemId: string | null | undefined;
  /** The saved replacement's code, for an edit form whose pick sits beyond page 1. */
  replacementItemCode?: string | null | undefined;
  onReplacementItem: (id: string | null) => void;
  /** Edit form: the item itself, left out of the picker. */
  selfId?: string | undefined;
}): React.JSX.Element {
  const [term, setTerm] = useState('');
  const list = useItemsList({ ...(term ? { search: term } : {}), limit: 50, offset: 0 });
  const options = useMemo<SearchableOption[]>(
    () =>
      (list.data?.items ?? [])
        .filter((i) => i.id !== selfId)
        .map((i) => ({ id: i.id, code: i.code, name: i.name })),
    [list.data?.items, selfId],
  );
  return (
    <>
      <FormField label="Customer Part No." size="md" htmlFor="customerPartNo">
        <Input
          id="customerPartNo"
          mono
          autoComplete="off"
          maxLength={64}
          value={customerPartNo ?? ''}
          onChange={(e) => onCustomerPartNo(e.target.value.trim() === '' ? null : e.target.value)}
        />
      </FormField>
      <FormField label="Replacement Item" size="lg" htmlFor="replacementItemId">
        <SearchableSelect
          id="replacementItemId"
          value={replacementItemId ?? null}
          onChange={onReplacementItem}
          options={options}
          onSearch={setTerm}
          loading={list.isFetching}
          error={list.error}
          clearable
          placeholder="Search item code or name…"
          {...(replacementItemCode ? { valueLabel: replacementItemCode } : {})}
        />
      </FormField>
    </>
  );
}
