// "Create PO from PR" route. Reached from the PR detail page's "Create PO"
// button (PR.id passed as a search param). Pre-fills the new-PO form with PR
// vendor/item already locked, lets the user pick the PO code + dates + GST,
// then on submit calls POST /purchase-orders/from-pr which creates the PO +
// stamps the PR atomically.

import {
  type CreatePurchaseOrderFromPrInput,
  PO_TYPES,
  type PoType,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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

function PurchaseOrderFromPrPage() {
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
  const { register, handleSubmit, formState } = form;

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
      await navigate({
        to: '/purchase-orders/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create PO from PR');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading source PR…
        </div>
      </main>
    );
  }

  if (isError || !pr) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Source PR not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'PR could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/purchase-requests">
                <ArrowLeft />
                Back to purchase requests
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // PRs that already have a PO can't convert again.
  const alreadyConverted = pr.poId !== null || pr.status === 'po_created';
  const isCancelled = pr.status === 'cancelled';

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/purchase-requests/$id" params={{ id: pr.id }}>
            <ArrowLeft />
            Back to PR
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">From PR {pr.code}</CardDescription>
            <CardTitle>Create purchase order</CardTitle>
          </CardHeader>
          <CardContent>
            {alreadyConverted ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                This PR is already linked to a PO. Open the PR detail to navigate to it.
              </p>
            ) : isCancelled ? (
              <p className="text-sm text-destructive">
                This PR is cancelled — no PO can be generated.
              </p>
            ) : (
              <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
                <Card className="border-dashed bg-muted/30">
                  <CardContent className="pt-4">
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                      <Pair
                        label="Vendor"
                        value={pr.vendorCodeText ?? (pr.vendorId ? '— linked —' : '—')}
                      />
                      <Pair
                        label="Item"
                        value={`${pr.itemCodeText ?? (pr.itemId ? '— linked —' : '—')} · ${pr.itemName ?? ''}`}
                      />
                      <Pair label="Qty" value={String(pr.qty)} />
                      <Pair label="Est. cost" value={`₹${Number(pr.estCost).toFixed(2)}`} />
                      <Pair label="Operation" value={pr.operation ?? '—'} />
                      <Pair label="Required by" value={pr.requiredDate ?? '—'} />
                    </dl>
                  </CardContent>
                </Card>

                <FieldRow>
                  <Field label="PO No." htmlFor="code" required>
                    <Input
                      id="code"
                      autoFocus
                      autoComplete="off"
                      placeholder="IN-PO-NNNNN"
                      {...register('code', { required: 'PO No. is required' })}
                    />
                  </Field>
                  <Field label="Date" htmlFor="poDate" required>
                    <Input
                      id="poDate"
                      type="date"
                      {...register('poDate', { required: 'Date is required' })}
                    />
                  </Field>
                  <Field label="Type" htmlFor="poType">
                    <Select id="poType" {...register('poType')}>
                      {PO_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FieldRow>

                <FieldRow>
                  <Field label="Due date" htmlFor="dueDate">
                    <Input id="dueDate" type="date" {...register('dueDate')} />
                  </Field>
                  <Field label="Tax type" htmlFor="taxType">
                    <Select id="taxType" {...register('taxType')}>
                      <option value="">— None —</option>
                      <option value="sgst_cgst">SGST + CGST</option>
                      <option value="igst">IGST</option>
                      <option value="none">None</option>
                    </Select>
                  </Field>
                </FieldRow>

                <FieldRow>
                  <Field label="SGST %" htmlFor="sgstPct">
                    <Input
                      id="sgstPct"
                      type="number"
                      step="0.01"
                      min={0}
                      {...register('sgstPct', { valueAsNumber: true })}
                    />
                  </Field>
                  <Field label="CGST %" htmlFor="cgstPct">
                    <Input
                      id="cgstPct"
                      type="number"
                      step="0.01"
                      min={0}
                      {...register('cgstPct', { valueAsNumber: true })}
                    />
                  </Field>
                  <Field label="IGST %" htmlFor="igstPct">
                    <Input
                      id="igstPct"
                      type="number"
                      step="0.01"
                      min={0}
                      {...register('igstPct', { valueAsNumber: true })}
                    />
                  </Field>
                </FieldRow>

                <Field label="Remarks" htmlFor="remarks">
                  <Textarea
                    id="remarks"
                    rows={2}
                    placeholder={`From PR ${pr.code}${pr.operation ? ` — ${pr.operation}` : ''} (default if blank)`}
                    {...register('remarks')}
                  />
                </Field>

                {submitError ? (
                  <p className="text-sm text-destructive">{submitError}</p>
                ) : null}

                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={formState.isSubmitting}>
                    {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
                    Create PO
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void navigate({ to: '/purchase-requests/$id', params: { id: pr.id } })}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function FieldRow(props: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{props.children}</div>;
}

function Field(props: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.htmlFor}>
        {props.label}
        {props.required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {props.children}
    </div>
  );
}

function Pair(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 font-medium">{props.value}</dd>
    </div>
  );
}
