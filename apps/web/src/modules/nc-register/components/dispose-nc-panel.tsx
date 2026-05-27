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

export interface JcOpOption {
  opSeq: number;
  operation: string;
}

interface Props {
  nc: NcRegister;
  // Human JC code (the NC read shape only carries jobCardId) for the context
  // block. Resolved upstream from the JC's loaded ops.
  jcCode?: string | null;
  // Full op list of the NC's JC (legacy `_disposeNC` renders every op). Empty
  // = fall back to a free number input / the NC's own op_seq.
  jcOps: JcOpOption[];
  onSubmit: (input: DisposeNcInput) => Promise<void> | void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}

export function DisposeNcPanel(props: Props): React.JSX.Element {
  const { nc, jcCode, jcOps, onSubmit, onCancel, pending, error } = props;

  const [action, setAction] = useState<NcDisposition | ''>('');
  const [reworkOpSeq, setReworkOpSeq] = useState<number | ''>(nc.opSeq ?? '');
  const [scrapCost, setScrapCost] = useState<number | ''>('');
  const [remarks, setRemarks] = useState<string>('');

  const reworkOps = useMemo<JcOpOption[]>(() => {
    if (jcOps.length > 0) return jcOps;
    return nc.opSeq != null ? [{ opSeq: nc.opSeq, operation: '' }] : [];
  }, [jcOps, nc.opSeq]);

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
        {/* Context block — legacy `_disposeNC` header (HTML L22621-22628). */}
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: 14,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <CtxField label="JC">
            <span className="mono" style={{ color: 'var(--cyan)' }}>
              {jcCode ?? '—'}
            </span>
          </CtxField>
          <CtxField label="ITEM">
            {nc.itemCodeText}
            {nc.itemNameText ? ` ${nc.itemNameText}` : ''}
          </CtxField>
          <CtxField label="OPERATION">
            {nc.opSeq != null ? `Op${nc.opSeq}` : ''}
            {nc.opSeq != null && (nc.operationText ?? nc.qcOperationText) ? ': ' : ''}
            {nc.operationText ?? nc.qcOperationText ?? (nc.opSeq == null ? '—' : '')}
          </CtxField>
          <CtxField label="REJECTED QTY">
            <span style={{ color: 'var(--red)' }}>{Number(nc.rejectedQty).toFixed(0)} pcs</span>
          </CtxField>
          <CtxField label="REASON">
            {nc.reasonCategory.replaceAll('_', ' ')}
            {nc.reason ? ` — ${nc.reason}` : ''}
          </CtxField>
        </div>
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
                    {reworkOps.map((o) => (
                      <option key={o.opSeq} value={o.opSeq}>
                        Op{o.opSeq}
                        {o.operation ? `: ${o.operation}` : ''}
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

function CtxField(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>{props.label}</span>
      <br />
      <b>{props.children}</b>
    </div>
  );
}
