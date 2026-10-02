// New CAPA modal — raise a CAPA, optionally against an NC (legacy _capaNew).
// Split out of capa-view.tsx (ADR-199 table-standard pass). NC Reference is a
// dropdown of NCs that don't yet have a CAPA; picking one back-fills
// jc/so/item/operation from the chosen NC (legacy L22832 / L22847-22850).

import {
  CAPA_TYPES,
  NC_REASON_CATEGORY_LABELS,
  type CapaRecord,
  type CreateCapaInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { todayIst } from '@/lib/date';
import { useNcRegisterList } from '@/modules/nc-register/api';
import { useCapaList, useCreateCapa, useNextCapaCode } from '../api';
import { Overlay } from './capa-overlay';

export function NewCapaModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (capa: CapaRecord) => void;
}): React.JSX.Element {
  const create = useCreateCapa();
  const nextCode = useNextCapaCode();
  // NC Reference is a dropdown of NCs that don't yet have a CAPA (legacy
  // _capaForNC filter, L22832). On pick, back-fill jc/so/item/operation from
  // the chosen NC (legacy L22847-22850).
  const ncQuery = useNcRegisterList({ limit: 200, offset: 0 });
  // EVERY CAPA (no limit), not the 25-row page on screen (ADR-201).
  const allCapas = useCapaList();
  const usedNcRefs = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCapas.data?.items ?? []) for (const r of c.ncRefs) set.add(r);
    return set;
  }, [allCapas.data]);
  const availableNcs = useMemo(
    () => (ncQuery.data?.items ?? []).filter((nc) => !usedNcRefs.has(nc.code)),
    [ncQuery.data, usedNcRefs],
  );

  const [type, setType] = useState<(typeof CAPA_TYPES)[number]>('Corrective');
  const [capaDate, setCapaDate] = useState(todayIst());
  const [ncRef, setNcRef] = useState('');
  const [jcNo, setJcNo] = useState('');
  const [soNo, setSoNo] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [operation, setOperation] = useState('');
  const [department, setDepartment] = useState('QC');
  const [problem, setProblem] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function onPickNc(code: string): void {
    setNcRef(code);
    const nc = availableNcs.find((x) => x.code === code);
    if (nc) {
      setJcNo(nc.jcCode ?? '');
      setSoNo(nc.soCodeText ?? '');
      setItemCode(nc.itemCode ?? nc.itemCodeText ?? '');
      setOperation(nc.jcOpOperation ?? nc.operationText ?? '');
    }
  }

  async function submit(): Promise<void> {
    setErr(null);
    if (!problem.trim()) {
      setErr('Problem Description is required.');
      return;
    }
    const input: CreateCapaInput = {
      type,
      capaDate,
      ncRefs: ncRef.trim() ? [ncRef.trim()] : [],
      problem: problem.trim(),
      department,
      ...(jcNo.trim() ? { jcNo: jcNo.trim() } : {}),
      ...(soNo.trim() ? { soNo: soNo.trim() } : {}),
      ...(itemCode.trim() ? { itemCode: itemCode.trim() } : {}),
      ...(operation.trim() ? { operation: operation.trim() } : {}),
    };
    try {
      const created = await create.mutateAsync(input);
      onCreated(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save CAPA. Try again.');
    }
  }

  return (
    <Overlay title="New CAPA" onClose={onClose}>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">CAPA No.</label>
          <input
            className="innovic-input"
            value={nextCode.data?.code ?? '(auto on save)'}
            readOnly
          />
        </div>
        <div className="form-grp">
          <label className="form-label">CAPA Type</label>
          <select
            className="innovic-select"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {CAPA_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">CAPA Date</label>
          <input
            type="date"
            className="innovic-input"
            value={capaDate}
            onChange={(e) => setCapaDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">NC Reference</label>
          <select
            className="innovic-select"
            value={ncRef}
            onChange={(e) => onPickNc(e.target.value)}
            disabled={ncQuery.isLoading}
          >
            <option value="">{ncQuery.isLoading ? 'Loading NCs…' : '— None —'}</option>
            {availableNcs.map((nc) => (
              <option key={nc.id} value={nc.code}>
                {nc.code} — {NC_REASON_CATEGORY_LABELS[nc.reasonCategory]} — {nc.jcCode ?? ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">JC No.</label>
          <input
            className="innovic-input"
            value={jcNo}
            onChange={(e) => setJcNo(e.target.value)}
            placeholder="Fills from NC"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">SO No.</label>
          <input
            className="innovic-input"
            value={soNo}
            onChange={(e) => setSoNo(e.target.value)}
            placeholder="Fills from NC"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Department</label>
          <select
            className="innovic-select"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            {['Production', 'QC', 'Store', 'Purchase', 'Design'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="form-grp form-full">
          <label className="form-label">
            Problem Description<span className="req">★</span>
          </label>
          <textarea
            className="innovic-input"
            rows={3}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder="Describe the problem / non-conformance…"
          />
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
          disabled={create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save CAPA
        </button>
      </div>
    </Overlay>
  );
}
