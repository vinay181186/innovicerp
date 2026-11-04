// Machine Group → New / Edit modal. Split out of machine-group-tab.tsx (ADR-199
// table conversion) so that file stays under the 400-line ceiling. Built on the
// ONE shared Modal, which owns the "Are you sure you want to exit?" question.

import type { MachineGroup } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';

export interface MachineGroupSaveInput {
  code: string;
  description: string | null;
  isActive: boolean;
}

export function MachineGroupModal({
  row,
  saving,
  onSave,
  onClose,
}: {
  row?: MachineGroup;
  saving: boolean;
  onSave: (input: MachineGroupSaveInput, id: string | null) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [code, setCode] = useState(row?.code ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!code.trim()) {
      setErr('Machine group is required.');
      return;
    }
    try {
      await onSave(
        { code: code.trim(), description: description.trim() || null, isActive },
        row?.id ?? null,
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save Machine Group. Try again.');
    }
  }

  return (
    <Modal
      title={row ? 'Edit Machine Group' : 'Add Machine Group'}
      maxWidth="min(620px, 96vw)"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{' '}
            {saving ? 'Saving…' : row ? 'Save Changes' : 'Save Machine Group'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="mgCode">
            Machine Group<span className="req">★</span>
          </label>
          <input
            id="mgCode"
            className="innovic-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. VMC"
            autoFocus={!row}
            // Permanent once created: machines and the screens that read
            // them snapshot this word. Retire a group with Status instead.
            readOnly={Boolean(row)}
          />
          {row ? (
            <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 3 }}>
              Cannot be changed. Set Status to Inactive to retire it.
            </div>
          ) : null}
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="mgDescription">
            Description
          </label>
          <input
            id="mgDescription"
            className="innovic-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. 3-axis VMCs, mill shop"
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="mgStatus">
            Active
          </label>
          <select
            id="mgStatus"
            className="innovic-select"
            value={isActive ? 'active' : 'inactive'}
            onChange={(e) => setIsActive(e.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
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
