// Dispose-NC inline panel (T-040b). Mirrors the legacy `_disposeNC` modal
// (line 22618) but rendered inline on the NC detail page since the project
// doesn't have a Dialog primitive yet (would force shadcn Dialog + Radix
// portal dependency for one screen — disproportionate).
//
// Action selector reveals conditional fields:
//   rework      → reworkOpSeq picker (defaults to NC.opSeq)
//   scrap       → scrapCost number
//   use_as_is   → no extra fields
//   return_to_vendor → no extra fields
//   make_fresh  → no extra fields (supplementary JC code is server-assigned)

import {
  type DisposeNcInput,
  NC_DISPOSITIONS,
  type NcDisposition,
  type NcRegister,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  nc: NcRegister;
  jcOpSeqs: number[];
  onSubmit: (input: DisposeNcInput) => Promise<void> | void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}

export function DisposeNcPanel(props: Props) {
  const { nc, jcOpSeqs, onSubmit, onCancel, pending, error } = props;

  const [action, setAction] = useState<NcDisposition | ''>('');
  const [reworkOpSeq, setReworkOpSeq] = useState<number | ''>(nc.opSeq ?? '');
  const [scrapCost, setScrapCost] = useState<number | ''>('');
  const [remarks, setRemarks] = useState<string>('');

  const reworkOps = useMemo(() => {
    if (jcOpSeqs.length > 0) return jcOpSeqs;
    return nc.opSeq != null ? [nc.opSeq] : [];
  }, [jcOpSeqs, nc.opSeq]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!action) return;
    const payload: DisposeNcInput = { action };
    if (remarks.trim().length > 0) payload.remarks = remarks.trim();
    if (action === 'rework' && reworkOpSeq !== '') {
      payload.reworkOpSeq = Number(reworkOpSeq);
    }
    if (action === 'scrap' && scrapCost !== '') {
      payload.scrapCost = Number(scrapCost);
    }
    void onSubmit(payload);
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-md border bg-muted/30 p-4"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide">Dispose</h3>
        <span className="text-xs text-muted-foreground">
          Rejected qty: <span className="font-mono font-semibold">{Number(nc.rejectedQty).toFixed(0)}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="dispAction">
            Action
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Select
            id="dispAction"
            value={action}
            onChange={(e) => setAction(e.target.value as NcDisposition | '')}
            required
          >
            <option value="">— Select action —</option>
            {NC_DISPOSITIONS.map((a) => (
              <option key={a} value={a}>
                {a.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </div>

        {action === 'rework' ? (
          <div className="space-y-2">
            <Label htmlFor="dispReworkOp">Rework to op_seq</Label>
            {reworkOps.length > 0 ? (
              <Select
                id="dispReworkOp"
                value={reworkOpSeq === '' ? '' : String(reworkOpSeq)}
                onChange={(e) =>
                  setReworkOpSeq(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">
                  {nc.opSeq != null ? `Defaults to op ${nc.opSeq}` : '— pick op —'}
                </option>
                {reworkOps.map((s) => (
                  <option key={s} value={s}>
                    op {s}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="dispReworkOp"
                type="number"
                min={1}
                value={reworkOpSeq === '' ? '' : reworkOpSeq}
                onChange={(e) =>
                  setReworkOpSeq(e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            )}
            <p className="text-xs text-muted-foreground">
              Increments <span className="font-mono">jc_ops.rework_qty</span> for the picked op.
            </p>
          </div>
        ) : null}

        {action === 'scrap' ? (
          <div className="space-y-2">
            <Label htmlFor="dispScrapCost">Scrap cost (₹)</Label>
            <Input
              id="dispScrapCost"
              type="number"
              min={0}
              step="0.01"
              value={scrapCost === '' ? '' : scrapCost}
              onChange={(e) =>
                setScrapCost(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </div>
        ) : null}
      </div>

      {action === 'use_as_is' && (nc.opSeq == null || nc.jcOpId == null) ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          ⚠ Use-As-Is needs the NC to have a resolved op_seq + jc_op_id. This NC has none —
          server will reject.
        </p>
      ) : null}

      {action === 'make_fresh' ? (
        <p className="text-sm text-blue-700 dark:text-blue-300">
          A supplementary JC will be created with qty {Number(nc.rejectedQty).toFixed(0)} and
          the origin's source SO/JW link inherited. Code: <span className="font-mono">&lt;origin&gt;-S&lt;n&gt;</span>.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="dispRemarks">Remarks</Label>
        <Textarea
          id="dispRemarks"
          rows={2}
          placeholder="Disposition notes…"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !action}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Apply disposition
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
