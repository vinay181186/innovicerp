// Receive-back route (T-059b). Loads the parent DC → renders per-line input
// for received + rejected qty + reject reason → submits a receipt. On full
// reconcile the DC status flips to received, auto-NCs are emitted for any
// rejected qty, and any outsource-op-driven JC cascade fires server-side.

import type { CreateDeliveryChallanReceiptInput, DeliveryChallanWithLines } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDeliveryChallan, useReceiveDeliveryChallan } from '../api';

export const deliveryChallanReceiveRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id/receive',
  component: DeliveryChallanReceivePage,
});

interface LineDraft {
  dcLineId: string;
  lineNo: number;
  itemCodeText: string;
  itemNameText: string | null;
  sentQty: number;
  alreadyReceived: number;
  remaining: number;
  receivedQty: string;
  rejectedQty: string;
  rejectReason: string;
}

function DeliveryChallanReceivePage() {
  const { id } = deliveryChallanReceiveRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useDeliveryChallan(id);
  const receive = useReceiveDeliveryChallan();

  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorInvoiceText, setVendorInvoiceText] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill drafts once the DC detail loads. Per-line "already received" is
  // computed from the existing receipts in the same payload — no extra fetch.
  useEffect(() => {
    if (!detail) return;
    const receivedByLine = computeReceivedByLine(detail);
    setLineDrafts(
      detail.lines.map((l) => {
        const already = receivedByLine.get(l.id) ?? 0;
        const sent = Number(l.qty);
        return {
          dcLineId: l.id,
          lineNo: l.lineNo,
          itemCodeText: l.itemCodeText,
          itemNameText: l.itemNameText,
          sentQty: sent,
          alreadyReceived: already,
          remaining: Math.max(0, sent - already),
          receivedQty: '',
          rejectedQty: '',
          rejectReason: '',
        };
      }),
    );
  }, [detail]);

  const updateDraft = (idx: number, patch: Partial<LineDraft>): void => {
    setLineDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const canSubmit = useMemo(() => {
    if (!receiptDate) return false;
    let anyQty = false;
    for (const d of lineDrafts) {
      const recv = Number(d.receivedQty || '0');
      const rej = Number(d.rejectedQty || '0');
      if (recv < 0 || rej < 0) return false;
      if (recv + rej > d.remaining) return false;
      if (recv > 0 || rej > 0) anyQty = true;
      if (rej > 0 && d.rejectReason.trim() === '') return false;
    }
    return anyQty && !submitting;
  }, [lineDrafts, receiptDate, submitting]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const linesPayload = lineDrafts
        .map((d) => ({
          deliveryChallanLineId: d.dcLineId,
          receivedQty: Number(d.receivedQty || '0'),
          rejectedQty: Number(d.rejectedQty || '0'),
          rejectReason: d.rejectReason.trim() === '' ? null : d.rejectReason.trim(),
        }))
        .filter((l) => l.receivedQty > 0 || l.rejectedQty > 0);

      const input: CreateDeliveryChallanReceiptInput = {
        receiptDate,
        vendorInvoiceText: vendorInvoiceText.trim() === '' ? null : vendorInvoiceText.trim(),
        remarks: remarks.trim() === '' ? null : remarks.trim(),
        lines: linesPayload,
      };
      await receive.mutateAsync({ dcId: id, input });
      void navigate({ to: '/delivery-challans/$id', params: { id } });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to record receipt.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-4xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading delivery challan…
        </div>
      </main>
    );
  }
  if (isError || !detail) {
    return (
      <main className="container max-w-4xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Delivery challan not found</CardTitle>
            <CardDescription>
              {error instanceof Error
                ? error.message
                : 'This delivery challan could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/delivery-challans">
                <ArrowLeft />
                Back to delivery challans
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/delivery-challans/$id" params={{ id }}>
            <ArrowLeft />
            Back to DC
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>Receive against {detail.vendorName ?? detail.vendorCodeText}</CardTitle>
            <CardDescription>
              Record qty received + rejected per line. Rejected qty auto-creates an NC; only the
              received qty goes back to stock.
            </CardDescription>
          </CardHeader>
        </Card>

        <form onSubmit={(e) => void onSubmit(e)}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Receipt header</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receiptDate">Receipt date</Label>
                  <Input
                    id="receiptDate"
                    type="date"
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vendorInvoice">Vendor invoice</Label>
                  <Input
                    id="vendorInvoice"
                    type="text"
                    placeholder="optional"
                    value={vendorInvoiceText}
                    onChange={(e) => setVendorInvoiceText(e.target.value)}
                  />
                </div>
                <div className="md:col-span-1 space-y-1.5">
                  <Label htmlFor="remarks">Remarks</Label>
                  <Input
                    id="remarks"
                    type="text"
                    placeholder="optional"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg">Lines</CardTitle>
              <CardDescription>
                Each row shows what was sent and what's still outstanding. Enter the qty just
                received. Reject reason is required when rejected qty &gt; 0.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Already recv</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead>Receive now</TableHead>
                      <TableHead>Reject now</TableHead>
                      <TableHead>Reject reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineDrafts.map((d, idx) => (
                      <TableRow key={d.dcLineId}>
                        <TableCell className="font-mono text-xs">{d.lineNo}</TableCell>
                        <TableCell className="text-sm">
                          <div className="font-mono text-xs">{d.itemCodeText}</div>
                          {d.itemNameText ? (
                            <div className="text-xs text-muted-foreground">{d.itemNameText}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {d.sentQty.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {d.alreadyReceived.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          {d.remaining.toFixed(0)}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={d.remaining}
                            value={d.receivedQty}
                            onChange={(e) => updateDraft(idx, { receivedQty: e.target.value })}
                            disabled={d.remaining === 0}
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={d.remaining}
                            value={d.rejectedQty}
                            onChange={(e) => updateDraft(idx, { rejectedQty: e.target.value })}
                            disabled={d.remaining === 0}
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            rows={2}
                            value={d.rejectReason}
                            onChange={(e) => updateDraft(idx, { rejectReason: e.target.value })}
                            placeholder={
                              Number(d.rejectedQty || '0') > 0 ? 'Required' : 'Only if rejecting'
                            }
                            disabled={Number(d.rejectedQty || '0') === 0}
                            className="min-w-[180px]"
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
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button asChild variant="outline" type="button">
              <Link to="/delivery-challans/$id" params={{ id }}>
                Cancel
              </Link>
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording…
                </>
              ) : (
                'Record receipt'
              )}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

function computeReceivedByLine(detail: DeliveryChallanWithLines): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of detail.receipts) {
    for (const rl of r.lines) {
      const prev = out.get(rl.deliveryChallanLineId) ?? 0;
      out.set(rl.deliveryChallanLineId, prev + Number(rl.receivedQty) + Number(rl.rejectedQty));
    }
  }
  return out;
}
