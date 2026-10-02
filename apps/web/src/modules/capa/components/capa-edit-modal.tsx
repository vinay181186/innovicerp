// CAPA 5-step edit modal — progress a saved CAPA through root cause →
// corrective action → verification → preventive action / closure (legacy
// _capaEdit). Split out of capa-view.tsx (ADR-199 table-standard pass).
// Read-only when opened from a row click or when the user lacks edit.

import {
  CAPA_EFFECTIVENESS,
  CAPA_RC_METHODS,
  CAPA_STATUSES,
  type CapaRecord,
  type UpdateCapaInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useOperatorsList } from '@/modules/operators/api';
import { useUsersList } from '@/modules/users/api';
import { useUpdateCapa } from '../api';
import { Overlay } from './capa-overlay';

export function EditCapaModal({
  capa,
  readOnly,
  onClose,
}: {
  capa: CapaRecord;
  readOnly: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const update = useUpdateCapa();
  // Responsible and Verified By are one select of operators + active users
  // (legacy L22862).
  const operatorsQuery = useOperatorsList({ limit: 200, offset: 0, isActive: true });
  const usersQuery = useUsersList({ limit: 200, offset: 0, isActive: true });
  const responsibleOptions = useMemo(() => {
    const names = new Set<string>();
    for (const o of operatorsQuery.data?.operators ?? []) {
      if (o.name) names.add(o.name);
    }
    for (const u of usersQuery.data?.items ?? []) {
      if (u.fullName) names.add(u.fullName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [operatorsQuery.data, usersQuery.data]);

  const [f, setF] = useState<UpdateCapaInput>({
    problem: capa.problem,
    rootCauseMethod: (capa.rootCauseMethod as UpdateCapaInput['rootCauseMethod']) ?? '5-Why',
    rootCause: capa.rootCause ?? '',
    correctiveAction: capa.correctiveAction ?? '',
    responsible: capa.responsible ?? '',
    targetDate: capa.targetDate ?? '',
    verification: capa.verification ?? '',
    verifiedBy: capa.verifiedBy ?? '',
    verifiedDate: capa.verifiedDate ?? '',
    preventiveAction: capa.preventiveAction ?? '',
    effectiveness: (capa.effectiveness as UpdateCapaInput['effectiveness']) ?? '',
    reviewDate: capa.reviewDate ?? '',
    status: capa.status,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof UpdateCapaInput>(k: K, v: UpdateCapaInput[K]): void =>
    setF((p) => ({ ...p, [k]: v }));

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await update.mutateAsync({ id: capa.id, input: f });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save CAPA. Try again.');
    }
  }

  const Step = (props: {
    n: number;
    title: string;
    children: React.ReactNode;
  }): React.JSX.Element => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 6 }}>
        Step {props.n}: {props.title}
      </div>
      {props.children}
    </div>
  );

  return (
    <Overlay title={`CAPA ${capa.code}`} onClose={onClose}>
      <div
        style={{
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          padding: 10,
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 12,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span className={`badge ${capa.type === 'Corrective' ? 'b-red' : 'b-blue'}`}>
          {capa.type}
        </span>
        <span>
          <span className="text3">NC No.</span>{' '}
          <b className="mono">{capa.ncRefs.join(', ') || '—'}</b>
        </span>
        <span>
          <span className="text3">JC No.</span> <b className="mono">{capa.jcNo ?? '—'}</b>
        </span>
        {/* POL — the CUSTOMER's own purchase-order line number off the SO line
            behind this CAPA. Read-only; it is typed only on the Sales Order. */}
        <span>
          <span className="text3">POL</span>{' '}
          <b className="mono" style={{ color: 'var(--purple)' }}>
            {capa.clientPoLineNo ?? '—'}
          </b>
        </span>
        <span>
          <span className="text3">Item Code</span>{' '}
          <b className="td-code" style={{ color: 'var(--text)' }}>
            {itemCodeWithRev(capa.itemCode, capa.itemRevision)}
          </b>
        </span>
      </div>

      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        <Step n={1} title="Problem Description">
          <textarea
            className="innovic-input"
            rows={3}
            value={f.problem ?? ''}
            onChange={(e) => set('problem', e.target.value)}
          />
        </Step>
        <Step n={2} title="Root Cause Analysis">
          <div className="form-grid" style={{ marginBottom: 6 }}>
            <div className="form-grp">
              <label className="form-label">Method</label>
              <select
                className="innovic-select"
                value={f.rootCauseMethod}
                onChange={(e) =>
                  set('rootCauseMethod', e.target.value as UpdateCapaInput['rootCauseMethod'])
                }
              >
                {CAPA_RC_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            className="innovic-input"
            rows={3}
            value={f.rootCause ?? ''}
            onChange={(e) => set('rootCause', e.target.value)}
            placeholder="Describe root cause…"
          />
        </Step>
        <Step n={3} title="Corrective Action">
          <textarea
            className="innovic-input"
            rows={3}
            value={f.correctiveAction ?? ''}
            onChange={(e) => set('correctiveAction', e.target.value)}
            placeholder="Actions taken to correct…"
          />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <div className="form-grp">
              <label className="form-label">Responsible</label>
              <select
                className="innovic-select"
                value={f.responsible ?? ''}
                onChange={(e) => set('responsible', e.target.value)}
              >
                <option value="">— Select —</option>
                {f.responsible && !responsibleOptions.includes(f.responsible) ? (
                  <option value={f.responsible}>{f.responsible}</option>
                ) : null}
                {responsibleOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Target Date</label>
              <input
                type="date"
                className="innovic-input"
                value={f.targetDate ?? ''}
                onChange={(e) => set('targetDate', e.target.value)}
              />
            </div>
          </div>
        </Step>
        <Step n={4} title="Verification">
          <textarea
            className="innovic-input"
            rows={2}
            value={f.verification ?? ''}
            onChange={(e) => set('verification', e.target.value)}
            placeholder="Verify corrective action effectiveness…"
          />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <div className="form-grp">
              <label className="form-label">Verified By</label>
              <select
                className="innovic-select"
                value={f.verifiedBy ?? ''}
                onChange={(e) => set('verifiedBy', e.target.value)}
              >
                <option value="">— Select —</option>
                {f.verifiedBy && !responsibleOptions.includes(f.verifiedBy) ? (
                  <option value={f.verifiedBy}>{f.verifiedBy}</option>
                ) : null}
                {responsibleOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Verification Date</label>
              <input
                type="date"
                className="innovic-input"
                value={f.verifiedDate ?? ''}
                onChange={(e) => set('verifiedDate', e.target.value)}
              />
            </div>
          </div>
        </Step>
        <Step n={5} title="Preventive Action & Closure">
          <textarea
            className="innovic-input"
            rows={2}
            value={f.preventiveAction ?? ''}
            onChange={(e) => set('preventiveAction', e.target.value)}
            placeholder="Systemic changes to prevent recurrence..."
          />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <div className="form-grp">
              <label className="form-label">Effectiveness</label>
              <select
                className="innovic-select"
                value={f.effectiveness}
                onChange={(e) =>
                  set('effectiveness', e.target.value as UpdateCapaInput['effectiveness'])
                }
              >
                {CAPA_EFFECTIVENESS.map((e2) => (
                  <option key={e2 || 'none'} value={e2}>
                    {e2 || '— Select —'}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Review Date</label>
              <input
                type="date"
                className="innovic-input"
                value={f.reviewDate ?? ''}
                onChange={(e) => set('reviewDate', e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">CAPA Status</label>
              <select
                className="innovic-select"
                value={f.status}
                onChange={(e) => set('status', e.target.value as UpdateCapaInput['status'])}
              >
                {CAPA_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </Step>
      </fieldset>

      {err ? (
        <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>
          {err}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {readOnly ? 'Close' : 'Cancel'}
        </button>
        {!readOnly ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={update.isPending}
            onClick={() => void submit()}
          >
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Changes
          </button>
        ) : null}
      </div>
    </Overlay>
  );
}
