// New DC route (T-059a). Pick a JW PO → load its lines → enter ship qty per
// line → submit. On success → redirect to detail. Mirrors PO from-pr pattern.

import type { CreateDeliveryChallanInput, Uom } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePurchaseOrder } from '@/modules/purchase-orders/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateDeliveryChallan } from '../api';

const newSearchSchema = z.object({
  poId: z.string().uuid().optional(),
});

export const deliveryChallanNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/new',
  validateSearch: newSearchSchema,
  component: DeliveryChallanNewPage,
});

interface LineDraft {
  purchaseOrderLineId: string;
  itemId: string;
  itemCodeText: string;
  itemNameText: string | null;
  uom: Uom;
  poLineQty: number;
  shipQty: string; // user-entered, parsed on submit
  materialText: string;
  dcRemarks: string;
}

function DeliveryChallanNewPage() {
  const { poId } = deliveryChallanNewRoute.useSearch();
  const navigate = useNavigate();
  const { data: po, isLoading: poLoading, isError: poError } = usePurchaseOrder(poId);
  const create = useCreateDeliveryChallan();

  const [code, setCode] = useState('');
  const [dcDate, setDcDate] = useState(new Date().toISOString().slice(0, 10));
  const [transport, setTransport] = useState('');
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill line drafts whenever the PO finishes loading.
  useEffect(() => {
    if (!po) return;
    setLineDrafts(
      po.lines.map((l) => ({
        purchaseOrderLineId: l.id,
        itemId: l.itemId ?? '',
        itemCodeText: l.itemCodeText ?? '',
        itemNameText: l.itemName ?? null,
        uom: 'NOS',
        poLineQty: Number(l.qty ?? 0),
        shipQty: '',
        materialText: '',
        dcRemarks: '',
      })),
    );
  }, [po]);

  const canSubmit = useMemo(
    () =>
      Boolean(po) &&
      code.trim().length > 0 &&
      lineDrafts.some((l) => Number(l.shipQty) > 0) &&
      lineDrafts.every((l) => {
        const q = Number(l.shipQty);
        if (l.shipQty === '') return true;
        return !Number.isNaN(q) && q > 0 && q <= l.poLineQty;
      }),
    [po, code, lineDrafts],
  );

  if (!poId) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Pick a JW PO first</CardTitle>
            <CardDescription>
              The new-DC form needs a purchase order to source line items from. Go to the PO list
              and click "New DC" on a JW PO.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/purchase-orders">
                <ArrowLeft />
                Go to purchase orders
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (poLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading purchase order…
        </div>
      </main>
    );
  }

  if (poError || !po) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Could not load PO</CardTitle>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const onSubmit = async (): Promise<void> => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const lines = lineDrafts
        .filter((l) => Number(l.shipQty) > 0)
        .map((l) => ({
          itemId: l.itemId,
          itemCodeText: l.itemCodeText,
          itemNameText: l.itemNameText,
          qty: Number(l.shipQty),
          uom: l.uom,
          purchaseOrderLineId: l.purchaseOrderLineId,
          materialText: l.materialText.trim() || null,
          dcRemarks: l.dcRemarks.trim() || null,
        }));
      const input: CreateDeliveryChallanInput = {
        header: {
          code: code.trim(),
          dcDate,
          purchaseOrderId: po.id,
          poCodeText: po.code,
          vendorId: po.vendorId!,
          vendorCodeText: po.vendorCodeText ?? po.code,
          transport: transport.trim() || null,
        },
        lines,
      };
      const created = await create.mutateAsync(input);
      void navigate({ to: '/delivery-challans/$id', params: { id: created.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create DC.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/delivery-challans">
            <ArrowLeft />
            Back to delivery challans
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New delivery challan</h1>
          <p className="text-sm text-muted-foreground">
            Issuing material against PO <span className="font-mono">{po.code}</span> — vendor{' '}
            <span className="font-medium">{po.vendorCodeText}</span>. Submit will flip linked
            outsource ops to <span className="font-mono">sent</span> and write a stock OUT ledger
            row per item.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Header</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="dc-code">DC code</Label>
                <Input
                  id="dc-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="DC-NNNNN"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dc-date">DC date</Label>
                <Input
                  id="dc-date"
                  type="date"
                  value={dcDate}
                  onChange={(e) => setDcDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dc-transport">Transport / vehicle</Label>
                <Input
                  id="dc-transport"
                  value={transport}
                  onChange={(e) => setTransport(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lines</CardTitle>
            <CardDescription>
              Enter ship qty per PO line. Lines with qty 0 are skipped.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO line</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>PO qty</TableHead>
                    <TableHead>Ship qty</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineDrafts.map((l, idx) => (
                    <TableRow key={l.purchaseOrderLineId}>
                      <TableCell className="font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-mono text-xs">{l.itemCodeText}</div>
                        {l.itemNameText ? (
                          <div className="text-xs text-muted-foreground">{l.itemNameText}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{l.poLineQty}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="1"
                          min={0}
                          max={l.poLineQty}
                          value={l.shipQty}
                          onChange={(e) =>
                            setLineDrafts((prev) => {
                              const next = prev.slice();
                              next[idx] = { ...next[idx]!, shipQty: e.target.value };
                              return next;
                            })
                          }
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={l.materialText}
                          onChange={(e) =>
                            setLineDrafts((prev) => {
                              const next = prev.slice();
                              next[idx] = { ...next[idx]!, materialText: e.target.value };
                              return next;
                            })
                          }
                          placeholder="optional"
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Textarea
                          rows={1}
                          value={l.dcRemarks}
                          onChange={(e) =>
                            setLineDrafts((prev) => {
                              const next = prev.slice();
                              next[idx] = { ...next[idx]!, dcRemarks: e.target.value };
                              return next;
                            })
                          }
                          placeholder="optional"
                          className="w-48"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {submitError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={() => void navigate({ to: '/delivery-challans' })}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit || submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              'Create DC'
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
