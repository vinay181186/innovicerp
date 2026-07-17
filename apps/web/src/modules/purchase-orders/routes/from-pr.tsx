// "Create PO from PR" route (UI-003-04).

import { type CreatePurchaseOrderFromPrInput, PO_TYPES, type PoType } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { usePurchaseRequest } from '@/modules/purchase-requests/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseOrderFromPr } from '../api';

const fromPrSearchSchema = z.object({
  prId: z.string().uuid(),
});

export const purchaseOrderFromPrRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/from-pr',
  validateSearch: fromPrSearchSchema,
  component: PurchaseOrderFromPrPage,
});

interface FormValues {
  code: string;
  poDate: string;
  poType: PoType;
  dueDate?: string;
  taxType?: string;
  sgstPct: number;
  cgstPct: number;
  igstPct: number;
  remarks?: string;
}

function PurchaseOrderFromPrPage(): React.JSX.Element {
  const { prId } = purchaseOrderFromPrRoute.useSearch();
  const navigate = useNavigate();
  const { data: pr, isLoading, isError, error } = usePurchaseRequest(prId);
  const createFromPr = useCreatePurchaseOrderFromPr();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaults: FormValues = {
    code: '',
    poDate: new Date().toISOString().slice(0, 10),
    poType: 'job_work',
    sgstPct: 0,
    cgstPct: 0,
    igstPct: 0,
  };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const [docNoValid, setDocNoValid] = useState(false);

  const onSubmit = async (values: FormValues): Promise<void> => {
    setSubmitError(null);
    if (!pr) return;
    const payload: CreatePurchaseOrderFromPrInput = {
      prId: pr.id,
      header: {
        code: values.code.trim(),
        poDate: values.poDate,
        poType: values.poType,
        dueDate: values.dueDate || undefined,
        taxType: values.taxType?.trim() || undefined,
        sgstPct: Number(values.sgstPct),
        cgstPct: Number(values.cgstPct),
        igstPct: Number(values.igstPct),
        remarks: values.remarks?.trim() || undefined,
      },
    };
    try {
      const created = await createFromPr.mutateAsync(payload);
      await navigate({ to: '/purchase-orders/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create PO from PR');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading source PR…
      </div>
    );
  }

  if (isError || !pr) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Source PR not found'}
          </div>
        </div>
      </div>
    );
  }

  const alreadyConverted = pr.poId !== null || pr.status === 'po_created';
  const isCancelled = pr.status === 'cancelled';

  return (
    <div>
      <Link
        to="/purchase-requests/$id"
        params={{ id: pr.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to PR
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code cyan fw-700">From PR {pr.code}</div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Create Purchase Order
            </div>
          </div>
        </div>
        <div className="panel-body">
          {alreadyConverted ? (
            <div
              style={{
                color: 'var(--amber2)',
                background: 'var(--amber3)',
                border: '1px solid #fcd34d',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
              }}
            >
              This PR is already linked to a PO. Open the PR detail to navigate to it.
            </div>
          ) : isCancelled ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
              }}
            >
              This PR is cancelled — no PO can be generated.
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)}>
              <div
                style={{
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 14,
                }}
              >
                <div className="form-grid">
                  <Pair
                    label="Vendor"
                    value={`${pr.vendorCode ?? pr.vendorCodeText ?? '—'}${pr.vendorName ? ` · ${pr.vendorName}` : ''}`}
                  />
                  <Pair
                    label="Item"
                    value={`${pr.itemCode ?? pr.itemCodeText ?? '—'} · ${pr.itemName ?? ''}`}
                  />
                  <Pair label="Qty" value={String(pr.qty)} />
                  <Pair label="Est. cost / pc" value={`₹${Number(pr.estCost).toFixed(2)}`} />
                  <Pair
                    label="Total est."
                    value={`₹${(Number(pr.estCost) * Number(pr.qty)).toFixed(2)}`}
                  />
                  <Pair label="Operation" value={pr.operation ?? '—'} />
                  <Pair label="Required by" value={pr.requiredDate ?? '—'} />
                </div>
              </div>

              <div className="form-grid form-grid-3">
                {/* Auto-fills the next IN-PO-##### and live-checks duplicates,
                    same as the main PO form. Previously this was a blank manual
                    input whose `required` error was never rendered, so pressing
                    Create PO with an empty PO No. silently did nothing. */}
                <DocNumberInput
                  type="purchase_order"
                  label="PO No."
                  required
                  value={watch('code') ?? ''}
                  onChange={(v) => setValue('code', v)}
                  onValidityChange={setDocNoValid}
                />
                <div className="form-grp">
                  <label className="form-label" htmlFor="poDate">
                    PO Date<span className="req">★</span>
                  </label>
                  <input
                    id="poDate"
                    type="date"
                    className="innovic-input"
                    {...register('poDate', { required: 'Date is required' })}
                  />
                  {formState.errors.poDate?.message ? (
                    <div className="form-error">{formState.errors.poDate.message}</div>
                  ) : null}
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="poType">
                    PO Type
                  </label>
                  <select id="poType" className="innovic-select" {...register('poType')}>
                    {PO_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-grp">
                  <label className="form-label" htmlFor="dueDate">
                    Due date
                  </label>
                  <input
                    id="dueDate"
                    type="date"
                    className="innovic-input"
                    {...register('dueDate')}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="taxType">
                    Tax type
                  </label>
                  <select id="taxType" className="innovic-select" {...register('taxType')}>
                    <option value="">— None —</option>
                    <option value="sgst_cgst">SGST + CGST</option>
                    <option value="igst">IGST</option>
                    <option value="none">None</option>
                  </select>
                </div>

                <div className="form-grp">
                  <label className="form-label" htmlFor="sgstPct">
                    SGST %
                  </label>
                  <input
                    id="sgstPct"
                    type="number"
                    step="0.01"
                    min={0}
                    className="innovic-input"
                    {...register('sgstPct', { valueAsNumber: true })}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="cgstPct">
                    CGST %
                  </label>
                  <input
                    id="cgstPct"
                    type="number"
                    step="0.01"
                    min={0}
                    className="innovic-input"
                    {...register('cgstPct', { valueAsNumber: true })}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="igstPct">
                    IGST %
                  </label>
                  <input
                    id="igstPct"
                    type="number"
                    step="0.01"
                    min={0}
                    className="innovic-input"
                    {...register('igstPct', { valueAsNumber: true })}
                  />
                </div>

                <div className="form-grp form-full">
                  <label className="form-label" htmlFor="remarks">
                    PO Remarks
                  </label>
                  <textarea
                    id="remarks"
                    className="innovic-textarea"
                    rows={2}
                    placeholder={`From PR ${pr.code}${pr.operation ? ` — ${pr.operation}` : ''} (default if blank)`}
                    {...register('remarks')}
                  />
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                {submitError ? (
                  <div
                    style={{
                      color: 'var(--red)',
                      background: 'var(--red3)',
                      border: '1px solid #fca5a5',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12,
                      marginBottom: 10,
                    }}
                  >
                    {submitError}
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void navigate({ to: '/purchase-requests/$id', params: { id: pr.id } })
                    }
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-success"
                    disabled={formState.isSubmitting || !docNoValid}
                  >
                    {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
                    ✓ Create PO
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Pair(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div className="fw-700">{props.value}</div>
    </div>
  );
}
