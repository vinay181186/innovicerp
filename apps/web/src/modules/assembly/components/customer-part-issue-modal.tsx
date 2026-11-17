// ADR-307 — Assembly Tracker › "Issue Customer RM →". Issues a customer-
// supplied BOM part (a Party Supplied BOM child, `<code>-RM`) from this SO's
// customer store to its assembly. The figures come from the tracker rows the
// page already loads (CLAUDE.md §20.5); the server re-checks every cap.

import type { AssemblyComponentRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { todayIst } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { Banner, Modal, useToast } from '@/ui/feedback';
import { FormField, SearchableSelect } from '@/ui/forms';
import { useIssueCustomerPart } from '../api';

/** The most this SO may issue of one customer part right now. */
export function customerPartIssueMax(c: AssemblyComponentRow): number {
  const cp = c.customerPart;
  if (!cp) return 0;
  return Math.max(0, Math.min(cp.inStoreQty, cp.needQty - cp.issuedQty));
}

/** The rows the pop-up can issue: customer parts with something in the store. */
export function issuableCustomerParts(rows: AssemblyComponentRow[]): AssemblyComponentRow[] {
  return rows.filter(
    (c) =>
      c.bomType === 'party_supplied' &&
      c.childItemId !== null &&
      (c.customerPart?.inStoreQty ?? 0) > 0,
  );
}

export function CustomerPartIssueModal({
  soId,
  components,
  onClose,
}: {
  soId: string;
  components: AssemblyComponentRow[];
  onClose: () => void;
}): React.JSX.Element {
  const formId = useId();
  const saveKey = useSaveKey();
  const issue = useIssueCustomerPart(soId, saveKey);
  const toast = useToast();
  const parts = useMemo(() => issuableCustomerParts(components), [components]);
  const [rmItemId, setRmItemId] = useState<string | null>(
    parts.length === 1 ? (parts[0]?.childItemId ?? null) : null,
  );
  const [issueDate, setIssueDate] = useState(() => todayIst());
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const picked = parts.find((c) => c.childItemId === rmItemId) ?? null;
  const max = picked ? customerPartIssueMax(picked) : 0;
  const options = parts.map((c) => ({
    id: c.childItemId ?? '',
    code: c.childItemCode,
    name: `${c.childItemName ?? ''} · In Customer Store ${c.customerPart?.inStoreQty ?? 0}`,
  }));

  async function onSave(): Promise<void> {
    setErr(null);
    const n = Number(qty);
    if (!picked || !rmItemId) return setErr('Pick the Customer RM.');
    if (!issueDate) return setErr('Issue Date is required.');
    if (!Number.isInteger(n) || n <= 0) return setErr('Issue Qty must be a whole number above 0.');
    if (n > max) return setErr(`Issue Qty cannot be more than ${max} for ${picked.childItemCode}.`);
    try {
      const res = await issue.mutateAsync({
        issueDate,
        rmItemId,
        qty: n,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      toast.ok(`Customer part issued — ${res.code}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not issue the customer part. Try again.');
    }
  }

  return (
    <Modal
      title="Issue Customer RM"
      onClose={onClose}
      closeLocked={issue.isPending}
      size="md"
      maxWidth="520px"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={issue.isPending || !picked || max <= 0}
          >
            {issue.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Saving…
              </>
            ) : (
              'Issue Customer RM'
            )}
          </button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void onSave();
        }}
      >
        {err ? <Banner tone="error">{err}</Banner> : null}
        <FormField label="Customer RM" required htmlFor={`${formId}-part`}>
          <SearchableSelect
            id={`${formId}-part`}
            value={rmItemId}
            onChange={(id) => {
              // Dependent field: a new part never keeps the old part's qty.
              setRmItemId(id);
              setQty('');
            }}
            options={options}
            placeholder="Search customer part code…"
            emptyText="No customer part in the customer store"
            selectedLabel={(o) => o.code ?? o.name}
          />
        </FormField>
        <FormField label="Issue Date" required htmlFor={`${formId}-date`}>
          <input
            id={`${formId}-date`}
            type="date"
            className="innovic-input mono"
            style={{ width: 160 }}
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </FormField>
        <FormField
          label="Issue Qty"
          required
          htmlFor={`${formId}-qty`}
          help={
            picked
              ? `Up to ${max} (In Customer Store ${picked.customerPart?.inStoreQty ?? 0})`
              : undefined
          }
        >
          <input
            id={`${formId}-qty`}
            type="number"
            min={1}
            max={max}
            step={1}
            className="innovic-input mono"
            style={{ width: 110 }}
            disabled={!picked}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </FormField>
        <FormField label="Remarks" htmlFor={`${formId}-remarks`}>
          <textarea
            id={`${formId}-remarks`}
            className="innovic-input"
            rows={2}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </FormField>
      </form>
    </Modal>
  );
}
