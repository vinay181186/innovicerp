// "+ New Substitution" (ADR-292): Engineering allows stock of one Drawing Rev
// to be used where an SO line, a JWSO line or a Job Card asks for another, up
// to a qty. The server checks the Engineering Change Approve tick, that the
// two Revs belong to the item and differ, and that exactly one scope is named.
//
// Dependent fields (house rule): a new Item clears both Revs and the scope
// document; a new "For" type clears the scope document.

import { type CreateRevSubstitutionInput, createRevSubstitutionInputSchema } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
import { useItemRevisions } from '@/modules/item-revisions/api';
import { useItemsList } from '@/modules/items/api';
import { useJobWorkOrderLinesList } from '@/modules/job-work-orders/api';
import { useSalesOrderLinesList } from '@/modules/sales-orders/api';
import { JobCardPicker } from '@/modules/store-issues/components/issue-pickers';
import { Banner, Modal, useToast } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect, Select, Textarea } from '@/ui/forms';
import { useCreateRevSubstitution } from '../api';

type Scope = 'so_line' | 'jw_line' | 'job_card';
const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'so_line', label: 'SO line' },
  { value: 'jw_line', label: 'JWSO line' },
  { value: 'job_card', label: 'Job Card' },
];

function ItemPicker({
  value,
  onChange,
}: {
  value: { id: string; code: string } | null;
  onChange: (v: { id: string; code: string } | null) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useItemsList({
    search: search.trim() || undefined,
    procurementType: 'make',
    limit: 50,
    offset: 0,
  });
  const options = useMemo(
    () => (data?.items ?? []).map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [data],
  );
  return (
    <SearchableSelect
      id="rs-item"
      value={value?.id ?? null}
      valueLabel={value?.code}
      onChange={(id) => {
        const it = options.find((o) => o.id === id);
        onChange(it ? { id: it.id, code: it.code } : null);
      }}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 Item code or name…"
      emptyText="No matching make item"
    />
  );
}

function SoLinePicker({
  itemCode,
  value,
  onChange,
}: {
  itemCode: string;
  value: string | null;
  onChange: (id: string | null) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useSalesOrderLinesList({
    search: search.trim() || itemCode,
    limit: 50,
    offset: 0,
  });
  const options = useMemo(
    () =>
      (data?.items ?? [])
        .filter((r) => r.lineId)
        .map((r) => ({
          id: r.lineId as string,
          code: `${soNoWithInternal(r.code, r.internalSoNo)} Ln ${r.lineNo ?? ''}`,
          name: `${r.itemCode ?? ''}${r.itemRevision ? `/${r.itemRevision}` : ''} · ${r.lineOrderQty} pcs`,
        })),
    [data],
  );
  return (
    <SearchableSelect
      id="rs-scope-doc"
      value={value}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 SO No. or item code…"
      emptyText="No matching SO line"
    />
  );
}

function JwLinePicker({
  itemCode,
  value,
  onChange,
}: {
  itemCode: string;
  value: string | null;
  onChange: (id: string | null) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useJobWorkOrderLinesList({
    search: search.trim() || itemCode,
    limit: 50,
    offset: 0,
  });
  const options = useMemo(
    () =>
      (data?.items ?? []).map((r) => ({
        id: r.lineId,
        code: `${r.docCode} Ln ${r.lineNo}`,
        name: `${r.itemCode ?? ''}${r.itemRevision ? `/${r.itemRevision}` : ''} · ${r.orderQty} pcs`,
      })),
    [data],
  );
  return (
    <SearchableSelect
      id="rs-scope-doc"
      value={value}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 JWSO No. or item code…"
      emptyText="No matching JWSO line"
    />
  );
}

export function NewRevSubDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [item, setItem] = useState<{ id: string; code: string } | null>(null);
  const [fromRev, setFromRev] = useState('');
  const [toRev, setToRev] = useState('');
  const [scope, setScope] = useState<Scope>('so_line');
  const [docId, setDocId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const saveKey = useSaveKey();
  const create = useCreateRevSubstitution(saveKey);
  const toast = useToast();
  const revs = useItemRevisions({ itemId: item?.id, limit: 100, offset: 0 }, { enabled: !!item });
  const revOptions = (revs.data?.items ?? []).map((r) => ({ value: r.id, label: r.label }));

  const pickItem = (v: { id: string; code: string } | null): void => {
    setItem(v);
    setFromRev('');
    setToRev('');
    setDocId(null);
  };

  const save = (): void => {
    setErr(null);
    if (!item) return setErr('Pick the Item.');
    const draft: CreateRevSubstitutionInput = {
      itemId: item.id,
      fromItemRevisionId: fromRev,
      toItemRevisionId: toRev,
      salesOrderLineId: scope === 'so_line' ? docId : null,
      jobWorkOrderLineId: scope === 'jw_line' ? docId : null,
      jobCardId: scope === 'job_card' ? docId : null,
      qtyAllowed: Number(qty),
      reason: reason.trim(),
      ecrId: null,
    };
    if (!fromRev || !toRev) return setErr('Pick both Drawing Revs.');
    if (!docId) return setErr('Pick what the substitution is for.');
    const parsed = createRevSubstitutionInputSchema.safeParse(draft);
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Check the form.');
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast.ok('Rev Substitution saved');
        onClose();
      },
      onError: (e) => setErr(e.message),
    });
  };

  return (
    <Modal
      title="New Rev Substitution"
      onClose={onClose}
      size="md"
      closeLocked={create.isPending}
      confirmExit={Boolean(item || qty || reason.trim())}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={save}
          >
            {create.isPending ? 'Saving…' : 'Save Substitution'}
          </button>
        </>
      }
    >
      <FormGrid>
        <FormField label="Item" required size="lg" htmlFor="rs-item">
          <ItemPicker value={item} onChange={pickItem} />
        </FormField>
        <FormField label="Stock Drawing Rev" required size="sm" htmlFor="rs-from">
          <Select
            id="rs-from"
            value={fromRev}
            onChange={(e) => setFromRev(e.target.value)}
            disabled={!item}
            placeholder={item ? 'Rev of the stock used' : 'Pick the Item first'}
            options={revOptions}
          />
        </FormField>
        <FormField label="Order Drawing Rev" required size="sm" htmlFor="rs-to">
          <Select
            id="rs-to"
            value={toRev}
            onChange={(e) => setToRev(e.target.value)}
            disabled={!item}
            placeholder={item ? 'Rev the order asks for' : 'Pick the Item first'}
            options={revOptions}
          />
        </FormField>
        <FormField label="For" required size="sm" htmlFor="rs-scope">
          <Select
            id="rs-scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setDocId(null);
            }}
            options={SCOPE_OPTIONS}
          />
        </FormField>
        <FormField
          label={SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? 'Document'}
          required
          size="lg"
          htmlFor="rs-scope-doc"
        >
          {!item ? (
            <span className="text3">Pick the Item first</span>
          ) : scope === 'so_line' ? (
            <SoLinePicker key={item.id} itemCode={item.code} value={docId} onChange={setDocId} />
          ) : scope === 'jw_line' ? (
            <JwLinePicker key={item.id} itemCode={item.code} value={docId} onChange={setDocId} />
          ) : (
            <JobCardPicker id="rs-scope-doc" value={docId} onChange={setDocId} />
          )}
        </FormField>
        <FormField label="Qty Allowed" required size="sm" htmlFor="rs-qty">
          <input
            id="rs-qty"
            type="number"
            min={0}
            step="any"
            className="innovic-input mono"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
        </FormField>
        <FormField label="Reason" required size="lg" htmlFor="rs-reason">
          <Textarea
            id="rs-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why Engineering allows this Rev (at least 5 characters)"
          />
        </FormField>
      </FormGrid>
      {err ? (
        <Banner tone="error" role="alert" flush>
          {err}
        </Banner>
      ) : null}
    </Modal>
  );
}
