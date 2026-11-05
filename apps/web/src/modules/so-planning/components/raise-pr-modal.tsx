// Raise PR box (ADR-171). Opened by "+ PR N" on a BUY line of the SO/JWSO
// Planning screen (SO tab only — a JWSO line is the client's material).
//
// A bought-in item is purchased, not planned: this box raises ONE standard
// purchase request against the SO line — qty, required date, remark — and
// closes. No plan, no route card, no Production Order. From there the normal
// Purchase flow (PR → PO → GRN → Incoming QC → stock) is untouched.
//
// ESC / click outside ask "Are you sure you want to exit?" through `Modal`.

import type { PlanningDetailResponse, PlanningLine } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { docDrawingRev, itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useRaisePlanningPr } from '../api';
import { Modal } from './modal';
import { useToast } from '@/ui/feedback';

const tileStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: 'var(--sp-2) var(--sp-4)',
  background: 'var(--bg)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
};

interface Props {
  so: PlanningDetailResponse;
  line: PlanningLine;
  onClose: () => void;
  /** Called with the new PR code once it is saved. */
  onRaised: (prCode: string) => void;
}

export function RaisePrModal({ so, line, onClose, onRaised }: Props): JSX.Element {
  const remaining = line.remaining;
  const [qty, setQty] = useState<number>(remaining);
  const [requiredDate, setRequiredDate] = useState<string>(line.dueDate ?? '');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const raise = useRaisePlanningPr();

  const submit = async () => {
    if (qty <= 0) {
      setErr('Qty must be greater than 0');
      return;
    }
    if (qty > remaining) {
      setErr(`Qty cannot be more than Pending (${remaining}).`);
      return;
    }
    setErr(null);
    try {
      const res = await raise.mutateAsync({
        soLineId: line.soLineId,
        qty,
        requiredDate: requiredDate === '' ? null : requiredDate,
        remarks: remarks.trim() === '' ? null : remarks.trim(),
      });
      toast.ok(`PR ${res.prCode} raised`);
      onRaised(res.prCode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not raise PR. Try again.');
    }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void submit()}
        disabled={raise.isPending}
      >
        {raise.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            Raising…
          </>
        ) : (
          'Raise PR'
        )}
      </button>
    </>
  );

  const lineLabel = line.itemCode
    ? itemCodeWithRev(line.itemCode, docDrawingRev(line))
    : (line.itemName ?? `Line ${line.lineNo}`);

  return (
    <Modal title={`Raise PR — ${lineLabel}`} onClose={onClose} footer={footer}>
      {/* ── What is being bought ── */}
      <div
        style={{
          background: 'var(--bg3)',
          padding: 'var(--sp-3)',
          borderRadius: 'var(--radius2)',
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>SO</span>
            <br />
            <b className="mono">
              {soNoWithInternal(so.soCode, so.soInternalNo)} Ln {line.lineNo}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>ITEM</span>
            <br />
            {/* Item code is the main thing: strong mono, darkest text. */}
            <b className="mono" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
              {itemCodeWithRev(line.itemCode, docDrawingRev(line))}
            </b>
            {line.itemName ? (
              <span className="text2" style={{ fontSize: 'var(--fs-sm)', marginLeft: 6 }}>
                {line.itemName}
              </span>
            ) : null}
            <span className="badge b-amber" style={{ marginLeft: 'var(--sp-2)' }}>
              Buy
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 10, flexWrap: 'wrap' }}>
          <div style={tileStyle}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Order Qty</div>
            <div className="mono fw-700" style={{ fontSize: 20 }}>
              {line.orderQty}
            </div>
          </div>
          <div style={tileStyle}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Already Raised</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--purple)' }}>
              {line.prQty}
            </div>
          </div>
          <div style={{ ...tileStyle, border: '1px solid var(--green)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Pending</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--green2)' }}>
              {remaining}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div className="form-grp" style={{ flex: '0 1 180px', minWidth: 0 }}>
          <label
            className="form-label"
            htmlFor="raise-pr-qty"
            style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 'var(--fs-sm)' }}
          >
            PR Qty<span className="req">★</span>
          </label>
          <input
            id="raise-pr-qty"
            type="number"
            min={1}
            max={remaining}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            style={{
              fontSize: 'var(--fs-lg)',
              fontWeight: 800,
              textAlign: 'center',
              border: '2px solid var(--purple)',
              color: 'var(--purple)',
              padding: 10,
              width: '100%',
            }}
          />
          <div
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 'var(--sp-1)' }}
          >
            Max: {remaining} pcs
          </div>
        </div>
        <div className="form-grp" style={{ flex: '1 1 160px', minWidth: 0 }}>
          <label className="form-label" htmlFor="raise-pr-date">
            Required date
          </label>
          <input
            id="raise-pr-date"
            type="date"
            className="innovic-input"
            value={requiredDate}
            onChange={(e) => setRequiredDate(e.target.value)}
          />
        </div>
      </div>
      <div className="form-grp">
        <label className="form-label" htmlFor="raise-pr-remark">
          Remarks
        </label>
        <textarea
          id="raise-pr-remark"
          className="innovic-input"
          rows={2}
          maxLength={500}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>

      {err ? (
        <div
          className="empty-state"
          style={{
            marginTop: 'var(--sp-3)',
            padding: 'var(--sp-2)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--red3)',
            color: 'var(--red2)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
