// Engineering Change create / edit form (ADR-291). ClusterGrid layout, Save at
// the BOTTOM in FormActions (owner rule), Ctrl+S through useSaveShortcut.
//
// Dependent fields (house rule): a new Item clears both Drawing Revs and the
// Replacement Item; Change Type "Not interchangeable" clears To Drawing Rev
// (a new item code replaces the part), any other type clears Replacement Item;
// To Drawing Rev never equals From Drawing Rev. The Rev pickers list only the
// picked item's Revs (GET /item-revisions?itemId=…) with their release status.

import {
  ECR_CLASSIFICATIONS,
  ECR_CLASSIFICATION_LABELS,
  ECR_CUSTOMER_APPROVAL,
  ECR_CUSTOMER_APPROVAL_LABELS,
  REV_RELEASE_STATUS_LABELS,
  type CreateEcrInput,
  type EcrClassification,
  type EcrCustomerApproval,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useItemRevisions } from '@/modules/item-revisions/api';
import { useItemsList } from '@/modules/items/api';
import { Banner } from '@/ui/feedback';
import {
  Cluster,
  ClusterGrid,
  FormField,
  Input,
  SearchableSelect,
  Select,
  Textarea,
} from '@/ui/forms';
import { FormActions, PageHeader, useSaveShortcut } from '@/ui/layout';

export interface EcrFormDraft {
  itemId: string | null;
  itemCode: string;
  fromItemRevisionId: string | null;
  toItemRevisionId: string | null;
  replacementItemId: string | null;
  replacementItemCode: string;
  classification: EcrClassification;
  description: string;
  customerApproval: EcrCustomerApproval;
  customerApprovalRef: string;
}

export const EMPTY_ECR_DRAFT: EcrFormDraft = {
  itemId: null,
  itemCode: '',
  fromItemRevisionId: null,
  toItemRevisionId: null,
  replacementItemId: null,
  replacementItemCode: '',
  classification: 'interchangeable',
  description: '',
  customerApproval: 'not_required',
  customerApprovalRef: '',
};

/** The draft → the create body. Null when a required field is missing. */
export function draftToInput(d: EcrFormDraft): CreateEcrInput | null {
  const newItem = d.classification === 'non_interchangeable';
  if (!d.itemId || !d.fromItemRevisionId) return null;
  if (newItem ? !d.replacementItemId : !d.toItemRevisionId) return null;
  if (d.description.trim().length < 5) return null;
  return {
    itemId: d.itemId,
    fromItemRevisionId: d.fromItemRevisionId,
    toItemRevisionId: newItem ? null : d.toItemRevisionId,
    replacementItemId: newItem ? d.replacementItemId : null,
    classification: d.classification,
    description: d.description.trim(),
    customerApproval: d.customerApproval,
    customerApprovalRef: d.customerApprovalRef.trim() || null,
  };
}

const TYPE_OPTIONS = ECR_CLASSIFICATIONS.map((v) => ({
  value: v,
  label: ECR_CLASSIFICATION_LABELS[v],
}));
const CUSTOMER_OPTIONS = ECR_CUSTOMER_APPROVAL.map((v) => ({
  value: v,
  label: ECR_CUSTOMER_APPROVAL_LABELS[v],
}));

function useMakeItemOptions(search: string) {
  const q = useItemsList({
    ...(search.trim() ? { search: search.trim() } : {}),
    procurementType: 'make',
    excludePartyOwned: true,
    limit: 50,
    offset: 0,
  });
  const options = (q.data?.items ?? []).map((i) => ({ id: i.id, code: i.code, name: i.name }));
  return { options, loading: q.isFetching, error: q.error };
}

export function EcrForm({
  title,
  initial,
  submitting,
  submitError,
  saveLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: EcrFormDraft;
  submitting: boolean;
  submitError: string | null;
  saveLabel: string;
  onSubmit: (input: CreateEcrInput) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [d, setD] = useState<EcrFormDraft>(initial);
  const [dirty, setDirty] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [replSearch, setReplSearch] = useState('');
  const items = useMakeItemOptions(itemSearch);
  const replItems = useMakeItemOptions(replSearch);
  const revsQ = useItemRevisions(
    { ...(d.itemId ? { itemId: d.itemId } : {}), limit: 200 },
    { enabled: Boolean(d.itemId) },
  );
  const revOptions = useMemo(
    () =>
      (d.itemId ? (revsQ.data?.items ?? []) : []).map((r) => ({
        id: r.id,
        code: r.label,
        name: REV_RELEASE_STATUS_LABELS[r.releaseStatus],
      })),
    [d.itemId, revsQ.data?.items],
  );
  const newItem = d.classification === 'non_interchangeable';
  const input = draftToInput(d);
  const canSave = !!input && !submitting;
  const save = (): void => {
    if (input && !submitting) onSubmit(input);
  };
  useSaveShortcut(save, canSave);

  const set = (patch: Partial<EcrFormDraft>): void => {
    setDirty(true);
    setD((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div>
      <PageHeader title={title} backLabel="Back" onBack={onCancel} dirty={dirty} />
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}
      <form
        id="ecr-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <ClusterGrid>
          <Cluster name="Part">
            <FormField label="Item Code" required htmlFor="ecr-item">
              <SearchableSelect
                id="ecr-item"
                value={d.itemId}
                onChange={(id) => {
                  const o = items.options.find((x) => x.id === id);
                  // A new item: its Revs differ, so both Rev picks and the
                  // replacement go.
                  set({
                    itemId: id,
                    itemCode: o?.code ?? '',
                    fromItemRevisionId: null,
                    toItemRevisionId: null,
                    replacementItemId: null,
                    replacementItemCode: '',
                  });
                }}
                onSearch={setItemSearch}
                options={items.options}
                loading={items.loading}
                error={items.error}
                placeholder="🔍 Search make item code or name…"
                valueLabel={d.itemCode || undefined}
                selectedLabel={(o) => o.code ?? o.name}
              />
            </FormField>
            <FormField label="From Drawing Rev" required htmlFor="ecr-from">
              <SearchableSelect
                id="ecr-from"
                value={d.fromItemRevisionId}
                onChange={(id) =>
                  set({
                    fromItemRevisionId: id,
                    ...(id && id === d.toItemRevisionId ? { toItemRevisionId: null } : {}),
                  })
                }
                options={revOptions}
                loading={revsQ.isFetching}
                error={revsQ.error}
                disabled={!d.itemId}
                placeholder={d.itemId ? 'Select Drawing Rev…' : 'Pick the item first'}
                emptyText="This item has no Drawing Rev"
                selectedLabel={(o) => o.code ?? o.name}
              />
            </FormField>
            <FormField label="Change Type" required htmlFor="ecr-type">
              <Select
                id="ecr-type"
                value={d.classification}
                options={TYPE_OPTIONS}
                onChange={(e) => {
                  const v = e.target.value as EcrClassification;
                  set(
                    v === 'non_interchangeable'
                      ? { classification: v, toItemRevisionId: null }
                      : { classification: v, replacementItemId: null, replacementItemCode: '' },
                  );
                }}
              />
            </FormField>
            {newItem ? (
              <FormField label="Replacement Item" required htmlFor="ecr-repl">
                <SearchableSelect
                  id="ecr-repl"
                  value={d.replacementItemId}
                  onChange={(id) => {
                    const o = replItems.options.find((x) => x.id === id);
                    set({ replacementItemId: id, replacementItemCode: o?.code ?? '' });
                  }}
                  onSearch={setReplSearch}
                  options={replItems.options.filter((o) => o.id !== d.itemId)}
                  loading={replItems.loading}
                  error={replItems.error}
                  placeholder="🔍 Search the new item code…"
                  valueLabel={d.replacementItemCode || undefined}
                  selectedLabel={(o) => o.code ?? o.name}
                />
              </FormField>
            ) : (
              <FormField label="To Drawing Rev" required htmlFor="ecr-to">
                <SearchableSelect
                  id="ecr-to"
                  value={d.toItemRevisionId}
                  onChange={(id) => set({ toItemRevisionId: id })}
                  options={revOptions.filter((o) => o.id !== d.fromItemRevisionId)}
                  loading={revsQ.isFetching}
                  error={revsQ.error}
                  disabled={!d.itemId}
                  placeholder={d.itemId ? 'Select the new Drawing Rev…' : 'Pick the item first'}
                  emptyText="No other Drawing Rev — add it in the Drawing Register"
                  selectedLabel={(o) => o.code ?? o.name}
                />
              </FormField>
            )}
          </Cluster>
          <Cluster name="Change">
            <FormField
              label="Description of Change"
              required
              htmlFor="ecr-desc"
              className="cl-span-4"
              help="What changes on the drawing, and why (at least 5 characters)."
            >
              <Textarea
                id="ecr-desc"
                rows={3}
                maxLength={2000}
                value={d.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </FormField>
          </Cluster>
          <Cluster name="Customer">
            <FormField label="Customer Approval" htmlFor="ecr-cust">
              <Select
                id="ecr-cust"
                value={d.customerApproval}
                options={CUSTOMER_OPTIONS}
                onChange={(e) => set({ customerApproval: e.target.value as EcrCustomerApproval })}
              />
            </FormField>
            <FormField label="Customer Reference" htmlFor="ecr-cref" className="cl-span-3">
              <Input
                id="ecr-cref"
                maxLength={200}
                value={d.customerApprovalRef}
                placeholder="Customer letter / e-mail / deviation no."
                onChange={(e) => set({ customerApprovalRef: e.target.value })}
              />
            </FormField>
          </Cluster>
        </ClusterGrid>
      </form>
      <FormActions dirty={dirty}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          form="ecr-form"
          className="btn btn-primary"
          disabled={!canSave}
          title={input ? undefined : 'Fill every ★ field first'}
        >
          {submitting ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Saving…
            </>
          ) : (
            saveLabel
          )}
        </button>
      </FormActions>
    </div>
  );
}
