// ADR-193 3c — Reserve parts for an assembly SO (hold free stock so another
// order cannot take it) and Release this SO's reservation of one part.
// The server caps a reservation at To Issue − already Reserved and at Available.
import type { SoMaterial, SoMaterialLine } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { soNoWithInternal } from '@/lib/so-number';
import { useReleaseParts, useReserveParts } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const REASON_MIN = 10;

function Shell({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 760, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

export function ReservePartsModal({
  data,
  onClose,
}: {
  data: SoMaterial;
  onClose: () => void;
}): React.JSX.Element {
  // Only parts that still need reserving: To Issue − Reserved > 0.
  const rows = data.lines
    .filter((l) => !l.notInBom)
    .map((l) => ({ l, needLeft: r3(l.toIssueQty - l.reservedQty) }))
    .filter((x) => x.needLeft > 0);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map(({ l, needLeft }) => {
        const q = r3(Math.max(0, Math.min(needLeft, l.availableQty)));
        return [l.itemId, q > 0 ? String(q) : ''];
      }),
    ),
  );
  const [err, setErr] = useState<string | null>(null);
  const reserve = useReserveParts(data.salesOrderId);

  const save = (): void => {
    setErr(null);
    const lines: Array<{ itemId: string; qty: number }> = [];
    for (const { l, needLeft } of rows) {
      const t = (qty[l.itemId] ?? '').trim();
      if (!t) continue;
      const q = Number(t);
      if (!Number.isFinite(q) || q <= 0)
        return setErr(`${l.itemCode}: Reserve Qty must be more than 0.`);
      if (r3(q) !== q) return setErr(`${l.itemCode}: at most 3 decimals.`);
      if (q > needLeft) return setErr(`${l.itemCode}: only ${needLeft} still needs reserving.`);
      lines.push({ itemId: l.itemId, qty: q });
    }
    if (lines.length === 0) return setErr('Enter a Reserve Qty on at least one part.');
    reserve.mutate(
      { lines },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not reserve. Try again.'),
      },
    );
  };

  return (
    <Shell
      title={`Reserve Parts — ${soNoWithInternal(data.soCode, data.soInternalNo)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={reserve.isPending || rows.length === 0}
            onClick={save}
          >
            {reserve.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Reserve'
            )}
          </button>
        </>
      }
    >
      {rows.length === 0 ? (
        <div className="empty-state">Every part is already issued or reserved.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>Item Code</th>
                <th className="th-num">To Issue</th>
                <th className="th-num">Reserved</th>
                <th className="th-num">Available</th>
                <th className="th-num">Reserve Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l }) => (
                <tr key={l.itemId}>
                  <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                    {l.itemCode}
                  </td>
                  <td className="mono td-num">{r3(l.toIssueQty)}</td>
                  <td className="mono td-num">{r3(l.reservedQty)}</td>
                  <td className="mono td-num">{r3(l.availableQty)}</td>
                  <td className="td-num">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="innovic-input mono fw-700"
                      style={{ width: 100, textAlign: 'right' }}
                      value={qty[l.itemId] ?? ''}
                      onChange={(e) => setQty((s) => ({ ...s, [l.itemId]: e.target.value }))}
                      onWheel={(e) => e.currentTarget.blur()}
                      aria-label={`Reserve Qty for ${l.itemCode}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err ? <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
    </Shell>
  );
}

export function ReleasePartModal({
  salesOrderId,
  line,
  onClose,
}: {
  salesOrderId: string;
  line: SoMaterialLine;
  onClose: () => void;
}): React.JSX.Element {
  const [qty, setQty] = useState(String(r3(line.reservedQty)));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const release = useReleaseParts(salesOrderId);

  const save = (): void => {
    setErr(null);
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return setErr('Release Qty must be more than 0.');
    if (q > line.reservedQty) return setErr(`Only ${r3(line.reservedQty)} is reserved.`);
    if (reason.trim().length < REASON_MIN)
      return setErr(`Give a reason (at least ${REASON_MIN} characters).`);
    release.mutate(
      { itemId: line.itemId, qty: q, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not release. Try again.'),
      },
    );
  };

  return (
    <Shell
      title={`Release ${line.itemCode}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={release.isPending}
            onClick={save}
          >
            Release
          </button>
        </>
      }
    >
      <div className="text2" style={{ fontSize: 12, marginBottom: 10 }}>
        Gives this SO&apos;s reserved stock back to free stock, where any order can use it.
      </div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Release Qty ★</label>
          <input
            type="number"
            min={0}
            step="any"
            className="innovic-input mono"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Reason ★</label>
          <input
            type="text"
            className="innovic-input"
            placeholder="e.g. customer changed the model"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      {err ? <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
    </Shell>
  );
}
