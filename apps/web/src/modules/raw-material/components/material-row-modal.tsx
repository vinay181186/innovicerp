// New/Edit modal for one Raw Material master row (Grade or Size). Same shape as
// the Report Type master's inline modal — this page has no separate create/edit
// route because it is one tabbed screen. Split out of material-master-panel.tsx
// so the panel stays under the 400-line ceiling once it moved onto the shared
// FIT <DataTable> (ADR-199 table standard, 2026-10-01).

import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/ui/feedback';
import type { MaterialMasterRow, MaterialMasterSaveInput } from './material-master-panel';

export function MaterialRowModal({
  noun,
  namePlaceholder,
  row,
  saving,
  onSave,
  onClose,
}: {
  noun: string;
  namePlaceholder: string;
  row?: MaterialMasterRow;
  saving: boolean;
  onSave: (input: MaterialMasterSaveInput, id: string | null) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [err, setErr] = useState<string | null>(null);

  // The cursor opens in the Name box, past the read-only Code on an edit. An
  // effect, not autoFocus: this runs after the Modal has noted who opened it.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit(): Promise<void> {
    setErr(null);
    if (!name.trim()) {
      setErr(`${noun} is required.`);
      return;
    }
    try {
      await onSave(
        {
          name: name.trim(),
          description: description.trim() || null,
          isActive,
        },
        row?.id ?? null,
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Could not save ${noun}. Try again.`);
    }
  }

  return (
    <Modal
      title={row ? `Edit ${noun}` : `Add ${noun}`}
      onClose={onClose}
      maxWidth="min(620px, 96vw)"
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
            {row ? 'Save Changes' : `Save ${noun}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {row ? (
          <div className="form-grp">
            <label className="form-label">Code</label>
            <input className="innovic-input" value={row.code} readOnly />
          </div>
        ) : null}
        <div className={row ? 'form-grp' : 'form-grp form-full'}>
          <label className="form-label">
            {noun}
            <span className="req">★</span>
          </label>
          <input
            className="innovic-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={namePlaceholder}
            ref={nameRef}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Description</label>
          <input
            className="innovic-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note — standard, equivalent, stock form…"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Active</label>
          <select
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
    </Modal>
  );
}
