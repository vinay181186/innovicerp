// Machine Group → New / Edit modal. Split out of machine-group-tab.tsx (ADR-199
// table conversion) so that file stays under the 400-line ceiling. The same
// inline modal the Raw Material masters use, because this is one tabbed screen
// with no separate create/edit route.

import type { MachineGroup } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExitConfirmDialog, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';

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

  // ESC and a click outside ASK before closing (user, 2026-09-12) -- the same
  // "Are you sure you want to exit?" every create / edit screen raises. This
  // modal used to close the instant ESC was pressed, taking the half-typed row
  // with it. The form's own Cancel button is untouched.
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // ESC with a type-to-search dropdown open is that dropdown's key.
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      setConfirmOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={(e) => {
        // Only the dim backdrop itself -- not the popup rendered inside it.
        if (e.target === e.currentTarget) setConfirmOpen(true);
      }}
    >
      {confirmOpen ? (
        <ExitConfirmDialog
          onStay={() => setConfirmOpen(false)}
          onExit={() => {
            setConfirmOpen(false);
            onClose();
          }}
        />
      ) : null}
      <div
        className="panel"
        style={{ width: 'min(620px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">{row ? 'Edit Machine Group' : 'Add Machine Group'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="mgCode">
                Machine Group <span className="req">★</span>
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
                <div className="text3" style={{ fontSize: 11, marginTop: 3 }}>
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
            <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
