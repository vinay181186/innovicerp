// Dispose-NC inline panel (UI-003-06). Mirrors legacy `_disposeNC` modal L22618.
// Inline (not a modal) — project doesn't have a Dialog primitive yet.

import {
  type DisposeNcInput,
  NC_DISPOSITIONS,
  type NcDisposition,
  type NcRegister,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

interface Props {
  nc: NcRegister;
  jcOpSeqs: number[];
  onSubmit: (input: DisposeNcInput) => Promise<void> | void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}

export function DisposeNcPanel(props: Props): React.JSX.Element {
  const { nc, jcOpSeqs, onSubmit, onCancel, pending, error } = props;

  const [action, setAction] = useState<NcDisposition | ''>('');
  const [reworkOpSeq, setReworkOpSeq] = useState<number | ''>(nc.opSeq ?? '');
  const [scrapCost, setScrapCost] = useState<number | ''>('');
  const [remarks, setRemarks] = useState<string>('');

  const reworkOps = useMemo(() => {
    if (jcOpSeqs.length > 0) return jcOpSeqs;
    return nc.opSeq != null ? [nc.opSeq] : [];
  }, [jcOpSeqs, nc.opSeq]);

  const submit = (e: React.FormEvent): void => {
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
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Dispose</div>
        <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
          Rejected qty:{' '}
          <b style={{ color: 'var(--text)' }}>{Number(nc.rejectedQty).toFixed(0)}</b>
        </span>
      </div>
      <div className="panel-body">
        <form onSubmit={submit}>
          <div className="form-grid form-grid-3">
            <div className="form-grp">
              <label className="form-label" htmlFor="dispAction">
                Action<span className="req">★</span>
              </label>
              <select
                id="dispAction"
                className="innovic-select"
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
              </select>
            </div>

            {action === 'rework' ? (
              <div className="form-grp">
                <label className="form-label" htmlFor="dispReworkOp">
                  Rework to op_seq
                </label>
                {reworkOps.length > 0 ? (
                  <select
                    id="dispReworkOp"
                    className="innovic-select"
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
                  </select>
                ) : (
                  <input
                    id="dispReworkOp"
                    type="number"
                    min={1}
                    className="innovic-input"
                    value={reworkOpSeq === '' ? '' : reworkOpSeq}
                    onChange={(e) =>
                      setReworkOpSeq(e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                )}
                <div className="form-help">
                  Increments <span className="mono">jc_ops.rework_qty</span> for the picked op.
                </div>
              </div>
            ) : null}

            {action === 'scrap' ? (
              <div className="form-grp">
                <label className="form-label" htmlFor="dispScrapCost">
                  Scrap cost (₹)
                </label>
                <input
                  id="dispScrapCost"
                  type="number"
                  min={0}
                  step="0.01"
                  className="innovic-input"
                  value={scrapCost === '' ? '' : scrapCost}
                  onChange={(e) =>
                    setScrapCost(e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
              </div>
            ) : null}

            <div className="form-grp form-full">
              <label className="form-label" htmlFor="dispRemarks">
                Remarks
              </label>
              <textarea
                id="dispRemarks"
                className="innovic-textarea"
                rows={2}
                placeholder="Disposition notes…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {action === 'use_as_is' && (nc.opSeq == null || nc.jcOpId == null) ? (
            <div
              style={{
                marginTop: 12,
                color: 'var(--amber2)',
                background: 'var(--amber3)',
                border: '1px solid #fcd34d',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              ⚠ Use-As-Is needs the NC to have a resolved op_seq + jc_op_id. This NC has none — server will reject.
            </div>
          ) : null}

          {action === 'make_fresh' ? (
            <div
              style={{
                marginTop: 12,
                color: 'var(--blue2)',
                background: 'var(--blue3)',
                border: '1px solid #93c5fd',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              A supplementary JC will be created with qty {Number(nc.rejectedQty).toFixed(0)} and
              the origin's source SO/JW link inherited. Code:{' '}
              <span className="mono">&lt;origin&gt;-S&lt;n&gt;</span>.
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                marginTop: 12,
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || !action}>
              {pending ? <Loader2 size={13} className="animate-spin" /> : null}
              Apply disposition
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
