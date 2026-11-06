// Confirm popup for "Set Return to Vendor" on the NC Register list. Built on
// Modal, not ConfirmDialog: ConfirmDialog sets its message inside a <p> (no table
// allowed) and has no result view with a single Close button.
//
// All saved: toast and close. Any refused: the popup stays, listing each NC with
// the server's own words; those NCs stay ticked in the list behind it.

import { useRef, useState } from 'react';
import { fmtQty } from '@/lib/qty-format';
import { Button } from '@/ui/core';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { Banner, Modal, useToast } from '@/ui/feedback';
import { type BulkRtvFailure, useBulkReturnToVendor } from '../api';
import type { NcRtvTick } from '../lib/use-nc-rtv-selection';

const TICK_COLUMNS: DataTableColumn<NcRtvTick>[] = [
  { header: 'NC No.', width: '34%', className: 'td-code', nowrap: true, render: (t) => t.code },
  {
    header: 'Item Code',
    width: '44%',
    ellipsis: true,
    title: (t) => t.itemCode,
    render: (t) => (
      <span className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>
        {t.itemCode || '—'}
      </span>
    ),
  },
  {
    header: 'Open Qty',
    width: '22%',
    align: 'right',
    className: 'mono',
    nowrap: true,
    render: (t) => fmtQty(t.openQty),
  },
];

const FAILURE_COLUMNS: DataTableColumn<BulkRtvFailure>[] = [
  { header: 'NC No.', width: '34%', className: 'td-code', nowrap: true, render: (f) => f.code },
  { header: 'Why It Was Refused', width: '66%', align: 'left', render: (f) => f.message },
];

export function BulkRtvDialog(props: {
  ticks: NcRtvTick[];
  /** The NCs the server accepted: untick these. */
  onSaved: (ids: string[]) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { ticks, onSaved, onClose } = props;
  const toast = useToast();
  const run = useBulkReturnToVendor();
  // isPending only turns true on the next render; this stops a double-click
  // landing inside that gap from sending the whole list twice.
  const fired = useRef(false);
  const [refused, setRefused] = useState<{ summary: string; failed: BulkRtvFailure[] } | null>(
    null,
  );

  const confirm = async (): Promise<void> => {
    if (fired.current) return;
    fired.current = true;
    const { saved, failed } = await run.mutateAsync(ticks);
    onSaved(saved.map(([id]) => id));
    const summary = `${saved.length} set, ${failed.length} failed`;
    if (failed.length === 0) {
      toast.ok(summary);
      onClose();
    } else {
      setRefused({ summary, failed });
    }
  };

  return (
    <Modal
      open
      size="sm"
      role="alertdialog"
      title={refused ? 'Set Return to Vendor: result' : `Set Return to Vendor: ${ticks.length} NC`}
      showClose={false}
      confirmExit={false}
      closeLocked={run.isPending}
      closeOnEscape={!run.isPending}
      closeOnOverlayClick={!run.isPending}
      onClose={onClose}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
      footer={
        refused ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={run.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={run.isPending}
              onClick={() => void confirm()}
            >
              Confirm
            </Button>
          </>
        )
      }
    >
      {refused ? (
        <>
          <Banner tone="warn" flush>
            {refused.summary}
          </Banner>
          <DataTable
            density="compact"
            sortFilter={false}
            maxHeight={320}
            columns={FAILURE_COLUMNS}
            rows={refused.failed}
          />
        </>
      ) : (
        <>
          <DataTable
            density="compact"
            sortFilter={false}
            maxHeight={320}
            columns={TICK_COLUMNS}
            rows={ticks}
          />
          <Banner tone="warn" flush>
            This cannot be undone. A DC is raised separately.
          </Banner>
        </>
      )}
    </Modal>
  );
}
