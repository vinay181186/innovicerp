// ADR-196 — ERPNext "Close" on a Sales Order: one line (the line's Close
// button) or the whole order (Actions ▾ → Close). The undelivered qty
// (Order Qty − Dispatched) is dropped; what was dispatched stays and can still
// be billed. A reason is required and stored on every line closed. The server
// refuses while a Job Card or Production Order is still running for a line and
// names them — that message is shown here as-is.

import type { SalesOrderDetail, SalesOrderLine } from '@innovic/shared';
import { useId, useState } from 'react';
import { soNoWithInternal } from '@/lib/so-number';
import { Button } from '@/ui/core';
import { Banner, Modal } from '@/ui/feedback';
import { FormField } from '@/ui/forms';
import { useCloseSalesOrder, useShortCloseSalesOrderLine } from '../api';

/** Qty a line would drop if closed now — 0 when it cannot be closed. */
export function closableQty(l: SalesOrderLine): number {
  if (l.shortClosedAt || l.status === 'cancelled') return 0;
  return Math.max(0, l.orderQty - l.dispatchedQty);
}

export function SoCloseModal(props: {
  detail: SalesOrderDetail;
  /** The line to close; null closes the whole order. */
  line: SalesOrderLine | null;
  onClose: () => void;
}): React.JSX.Element {
  const { detail, line, onClose } = props;
  const formId = useId();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const closeLine = useShortCloseSalesOrderLine(detail.id);
  const closeSo = useCloseSalesOrder(detail.id);
  const pending = closeLine.isPending || closeSo.isPending;

  const targets = line ? [line] : detail.lines.filter((l) => closableQty(l) > 0);
  const dropped = targets.reduce((s, l) => s + closableQty(l), 0);

  const onConfirm = (): void => {
    setErr(null);
    const r = reason.trim();
    if (!r) {
      setErr('Give a reason — it is stored on every line closed.');
      return;
    }
    const onError = (e: Error): void => setErr(e.message || 'Could not close. Try again.');
    if (line) {
      closeLine.mutate({ lineId: line.id, reason: r }, { onSuccess: onClose, onError });
    } else {
      closeSo.mutate({ reason: r }, { onSuccess: onClose, onError });
    }
  };

  return (
    <Modal
      title={
        line
          ? `Close SO ${soNoWithInternal(detail.code, detail.internalSoNo)} — Line ${line.lineNo}`
          : `Close SO ${soNoWithInternal(detail.code, detail.internalSoNo)}`
      }
      onClose={onClose}
      size="md"
      maxWidth="520px"
      closeOnOverlayClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Keep it open
          </Button>
          <Button variant="danger" type="submit" form={formId} loading={pending}>
            {pending ? 'Closing…' : line ? 'Close Line' : 'Close SO'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onConfirm();
        }}
      >
        <p className="text2" style={{ marginTop: 0, lineHeight: 1.6 }}>
          {line ? (
            <>
              Line {line.lineNo} has <b>{line.dispatchedQty}</b> of <b>{line.orderQty}</b>{' '}
              dispatched. Closing drops the other{' '}
              <b style={{ color: 'var(--amber2)' }}>{dropped}</b> — no more planning, production or
              dispatch for them.
            </>
          ) : (
            <>
              Closes <b>{targets.length}</b> line{targets.length === 1 ? '' : 's'} still to dispatch
              and drops <b style={{ color: 'var(--amber2)' }}>{dropped}</b> undelivered — no more
              planning, production or dispatch for them.
            </>
          )}{' '}
          What was dispatched stays and can still be invoiced.
        </p>
        <FormField label="Reason" required htmlFor={`${formId}-reason`}>
          <input
            id={`${formId}-reason`}
            className="innovic-input"
            autoFocus
            autoComplete="off"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer cancelled the balance"
          />
        </FormField>
        {err ? (
          <Banner tone="error" flush>
            {err}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
