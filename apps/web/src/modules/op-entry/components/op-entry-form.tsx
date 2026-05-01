import {
  type JcOpEnriched,
  SHIFTS,
  type Shift,
  type StartOpInput,
  type SubmitOpLogInput,
} from '@innovic/shared';
import { Loader2, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useStartOp, useStopOp, useSubmitOpLog } from '../api';

interface Props {
  op: JcOpEnriched;
  // Active running session id for this op, if any (for the Stop button).
  activeRunningId: string | null;
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowHHMM(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export function OpEntryForm({ op, activeRunningId }: Props) {
  const submit = useSubmitOpLog();
  const start = useStartOp();
  const stop = useStopOp();

  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [qty, setQty] = useState<string>('');
  const [rejectQty, setRejectQty] = useState<string>('0');
  const [operatorName, setOperatorName] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset when the selected op changes.
  useEffect(() => {
    setQty('');
    setRejectQty('0');
    setRemarks('');
    setErrorMessage(null);
  }, [op.id]);

  const isOutsource = op.opType === 'outsource';
  const isQcPending = op.computedStatus === 'qc_pending';
  const noAvailable = op.available <= 0;
  const blockedReason = isOutsource
    ? 'This is an outsource operation; use the Procurement flow.'
    : isQcPending
      ? 'Waiting on QC clearance — go to QC dashboard.'
      : noAvailable
        ? 'No qty available — start the previous op first.'
        : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    const qtyNum = Number(qty);
    if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
      setErrorMessage('Qty must be a positive integer.');
      return;
    }
    const rejNum = Number(rejectQty || '0');
    const input: SubmitOpLogInput = {
      jcOpId: op.id,
      qty: qtyNum,
      rejectQty: Number.isFinite(rejNum) && rejNum >= 0 ? rejNum : 0,
      logDate,
      shift,
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await submit.mutateAsync(input);
      setQty('');
      setRejectQty('0');
      setRemarks('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Submit failed');
    }
  }

  async function handleStart() {
    setErrorMessage(null);
    const input: StartOpInput = {
      jcOpId: op.id,
      startDate: logDate,
      startTime: nowHHMM(),
      shift,
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await start.mutateAsync(input);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Start failed');
    }
  }

  async function handleStop() {
    if (!activeRunningId) return;
    setErrorMessage(null);
    try {
      await stop.mutateAsync(activeRunningId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Stop failed');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Log entry</h3>
        <span className="text-xs text-muted-foreground">
          Op {op.opSeq} · <span className="font-mono">{op.operation}</span>
        </span>
      </div>

      {blockedReason ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {blockedReason}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="opf-date">Date</Label>
          <Input
            id="opf-date"
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="opf-shift">Shift</Label>
          <Select id="opf-shift" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {s === 'day' ? 'Day' : 'Night'}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="opf-qty">Qty done</Label>
          <Input
            id="opf-qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={op.available}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            disabled={blockedReason !== null}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="opf-rej">Reject qty</Label>
          <Input
            id="opf-rej"
            type="number"
            inputMode="numeric"
            min={0}
            value={rejectQty}
            onChange={(e) => setRejectQty(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="opf-op">Operator</Label>
          <Input
            id="opf-op"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            placeholder="Operator name"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="opf-rem">Remarks</Label>
          <Textarea
            id="opf-rem"
            rows={1}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional notes…"
          />
        </div>
      </div>

      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={blockedReason !== null || submit.isPending}>
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit completion
        </Button>
        {activeRunningId ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleStop()}
            disabled={stop.isPending}
          >
            <Square />
            Stop ({stop.isPending ? 'stopping…' : 'running'})
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleStart()}
            disabled={blockedReason !== null || start.isPending}
          >
            <Play />
            Start session
          </Button>
        )}
      </div>
    </form>
  );
}
