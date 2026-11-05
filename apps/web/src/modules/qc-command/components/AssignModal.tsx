// Assign Inspector modal (admin only — legacy _qccAssign L18735). Allocates a
// pending QC op to any active inspector with an optional note.

import { type QcCommandQueueRow, type QcInspectorOption, opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal, useToast } from '@/ui/feedback';
import { SearchableSelect } from '@/ui/forms';
import { useAssignQc } from '../api';

export function AssignModal({
  row,
  inspectors,
  onClose,
}: {
  row: QcCommandQueueRow;
  inspectors: QcInspectorOption[];
  onClose: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const assign = useAssignQc();
  const [inspectorUserId, setInspectorUserId] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!inspectorUserId) {
      setErr('Select an inspector.');
      return;
    }
    try {
      await assign.mutateAsync({
        jcOpId: row.jcOpId,
        inspectorUserId,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.ok(`Inspector assigned — ${row.jcCode} Op ${opSrNo(row.opSeq)}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not assign inspector. Try again.');
    }
  }

  return (
    <Modal
      title={`Assign Inspector — ${row.jcCode} Op ${opSrNo(row.opSeq)}`}
      onClose={onClose}
      maxWidth="min(1100px, 96vw)"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={assign.isPending}
            onClick={() => void submit()}
          >
            {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Assign
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label">
            Assign to Inspector<span className="req">★</span>
          </label>
          <SearchableSelect
            ariaLabel="Assign to Inspector"
            value={inspectorUserId || null}
            onChange={(id) => setInspectorUserId(id ?? '')}
            options={inspectors.map((u) => ({ id: u.id, name: `${u.name} (${u.role})` }))}
            placeholder="— Select —"
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Note (optional)</label>
          <input
            className="innovic-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Priority, instructions…"
          />
        </div>
      </div>
      {err ? (
        <div
          role="alert"
          style={{ color: 'var(--red2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-2)' }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
