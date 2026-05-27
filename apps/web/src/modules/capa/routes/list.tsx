// CAPA — Corrective & Preventive Action (legacy renderCAPA L22779 + _capaNew /
// _capaEdit 5-step). Legacy chrome. 6 cards + overdue alert + 10-col table +
// New modal + 5-step edit modal. Backed by /capa (capa_records, migration 0034).

import {
  CAPA_EFFECTIVENESS,
  CAPA_RC_METHODS,
  CAPA_STATUSES,
  CAPA_TYPES,
  type CapaRecord,
  type CreateCapaInput,
  type UpdateCapaInput,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { useNcRegisterList } from '@/modules/nc-register/api';
import { useOperatorsList } from '@/modules/operators/api';
import { useUsersList } from '@/modules/users/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCapaList, useCreateCapa, useUpdateCapa } from '../api';

export const capaListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'capa',
  component: CapaPage,
});

function statusColor(s: string): string {
  if (s === 'Open') return 'var(--amber)';
  if (s === 'In Progress') return 'var(--blue)';
  if (s === 'Verified') return 'var(--purple)';
  if (s === 'Closed') return 'var(--green)';
  return 'var(--text3)';
}

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; capa: CapaRecord };

function CapaPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useCapaList();
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';
  const [term, setTerm] = useState('');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  const items = data?.items ?? [];
  const counters = data?.counters;
  const overdue = items.filter((c) => c.overdue);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return items;
    return items.filter((c) =>
      [c.code, c.problem, c.ncRefs.join(' '), c.jcNo ?? '', c.responsible ?? '']
        .join(' ')
        .toLowerCase()
        .includes(t),
    );
  }, [items, term]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🛡 CAPA — Corrective &amp; Preventive Action
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" />
            </span>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'var(--purple)', borderColor: 'var(--purple)' }}
              onClick={() => setModal({ kind: 'new' })}
            >
              ➕ New CAPA
            </button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading CAPA…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load CAPA'}
          </div>
        </div>
      ) : (
        <>
          {overdue.length > 0 ? (
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--amber3)',
                border: '1px solid var(--amber2)',
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 12,
                color: 'var(--amber)',
              }}
            >
              ⚠️ <b>{overdue.length} CAPA(s) overdue!</b> {overdue.map((c) => c.code).join(', ')}
            </div>
          ) : null}

          {/* Counter cards */}
          {counters ? (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <Card label="Total" value={counters.total} color="var(--purple)" />
              <Card label="Open" value={counters.open} color="var(--amber)" />
              <Card label="In Progress" value={counters.inProgress} color="var(--blue)" />
              <Card label="Verified" value={counters.verified} color="var(--purple)" />
              <Card label="Closed" value={counters.closed} color="var(--green)" />
              <Card label="Effectiveness" value={`${counters.effectivenessPct}%`} color="var(--green)" />
            </div>
          ) : null}

          <div className="panel" style={{ marginBottom: 10, padding: '10px 14px' }}>
            <input
              className="innovic-input"
              style={{ width: 280, fontSize: 12 }}
              placeholder="🔍 Search CAPA, NC, problem…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>

          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>CAPA No.</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>NC Ref</th>
                    <th>Problem</th>
                    <th>Root Cause</th>
                    <th>Responsible</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="empty-state">
                        No CAPAs. Create from NC Register or click ➕ New CAPA.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((c) => (
                      <tr key={c.id} style={c.overdue ? { borderLeft: '3px solid var(--red)' } : undefined}>
                        <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                          {c.code}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 3,
                              color: c.type === 'Corrective' ? 'var(--red)' : 'var(--blue)',
                              background:
                                c.type === 'Corrective'
                                  ? 'rgba(220,38,38,0.1)'
                                  : 'rgba(37,99,235,0.1)',
                            }}
                          >
                            {c.type}
                          </span>
                        </td>
                        <td style={{ fontSize: 11 }}>{c.capaDate}</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
                          {c.ncRefs.join(', ') || '—'}
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.problem}>
                          {c.problem}
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.rootCause ?? ''}>
                          {c.rootCause ? c.rootCause : <span className="text3" style={{ fontStyle: 'italic' }}>Pending…</span>}
                        </td>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>{c.responsible ?? '—'}</td>
                        <td style={{ fontSize: 11, color: c.overdue ? 'var(--red)' : undefined, fontWeight: c.overdue ? 700 : 400 }}>
                          {c.targetDate ?? '—'}
                          {c.overdue ? ' ⚠' : ''}
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: statusColor(c.status) }}>
                            {c.status}
                          </span>
                        </td>
                        <td>
                          {canWrite && c.status !== 'Closed' ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setModal({ kind: 'edit', capa: c })}
                            >
                              ✏ Edit
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setModal({ kind: 'edit', capa: c })}
                            >
                              👁 View
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modal.kind === 'new' ? (
        <NewCapaModal capas={items} onClose={() => setModal({ kind: 'none' })} />
      ) : null}
      {modal.kind === 'edit' ? (
        <EditCapaModal
          capa={modal.capa}
          readOnly={!canWrite}
          onClose={() => setModal({ kind: 'none' })}
        />
      ) : null}
    </div>
  );
}

function Card(props: { label: string; value: number | string; color: string }): React.JSX.Element {
  return (
    <div className="panel" style={{ minWidth: 90, padding: 12, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 10 }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 22, color: props.color }}>
        {props.value}
      </div>
    </div>
  );
}

function Overlay(props: { title: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={props.onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(640px, 100%)', maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">{props.title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">{props.children}</div>
      </div>
    </div>
  );
}

function NewCapaModal({
  capas,
  onClose,
}: {
  capas: CapaRecord[];
  onClose: () => void;
}): React.JSX.Element {
  const create = useCreateCapa();
  // NC Reference is a dropdown of NCs that don't yet have a CAPA (legacy
  // _capaForNC filter, L22832). On pick, back-fill jc/so/item/operation from
  // the chosen NC (legacy L22847-22850).
  const ncQuery = useNcRegisterList({ limit: 200, offset: 0 });
  const usedNcRefs = useMemo(() => {
    const set = new Set<string>();
    for (const c of capas) for (const r of c.ncRefs) set.add(r);
    return set;
  }, [capas]);
  const availableNcs = useMemo(
    () => (ncQuery.data?.items ?? []).filter((nc) => !usedNcRefs.has(nc.code)),
    [ncQuery.data, usedNcRefs],
  );

  const [type, setType] = useState<(typeof CAPA_TYPES)[number]>('Corrective');
  const [capaDate, setCapaDate] = useState(new Date().toISOString().slice(0, 10));
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
      setErr('Describe the problem.');
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
      await create.mutateAsync(input);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    }
  }

  return (
    <Overlay title="➕ New CAPA" onClose={onClose}>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Type ★</label>
          <select className="innovic-select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {CAPA_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Date</label>
          <input type="date" className="innovic-input" value={capaDate} onChange={(e) => setCapaDate(e.target.value)} />
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
                {nc.code} — {nc.reasonCategory} — {nc.jcCode ?? ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">JC / SO Reference</label>
          <input className="innovic-input" value={jcNo} onChange={(e) => setJcNo(e.target.value)} placeholder="JC or SO number" />
        </div>
        <div className="form-grp">
          <label className="form-label">Department</label>
          <select className="innovic-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
            {['Production', 'QC', 'Store', 'Purchase', 'Design'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Problem Description ★</label>
          <textarea className="innovic-input" rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Describe the problem / non-conformance…" />
        </div>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void submit()}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create CAPA
        </button>
      </div>
    </Overlay>
  );
}

function EditCapaModal({
  capa,
  readOnly,
  onClose,
}: {
  capa: CapaRecord;
  readOnly: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const update = useUpdateCapa();
  // Responsible is a select of operators + active users (legacy L22862).
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
      setErr(e instanceof Error ? e.message : 'Update failed');
    }
  }

  const Step = (props: { n: number; title: string; children: React.ReactNode }): React.JSX.Element => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 6 }}>
        Step {props.n}: {props.title}
      </div>
      {props.children}
    </div>
  );

  return (
    <Overlay title={`${readOnly ? '👁' : '✏'} CAPA — ${capa.code} (5-Step)`} onClose={onClose}>
      <div
        style={{
          background: 'rgba(124,58,237,0.06)',
          border: '1px solid rgba(124,58,237,0.2)',
          padding: 10,
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 12,
        }}
      >
        <b style={{ color: 'var(--purple)' }}>{capa.code}</b> · {capa.type} · NC:{' '}
        {capa.ncRefs.join(', ') || '—'} · JC: {capa.jcNo ?? '—'} · Item: {capa.itemCode ?? '—'}
      </div>

      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        <Step n={1} title="Problem Description">
          <textarea className="innovic-input" rows={3} value={f.problem ?? ''} onChange={(e) => set('problem', e.target.value)} />
        </Step>
        <Step n={2} title="Root Cause Analysis">
          <div className="form-grid" style={{ marginBottom: 6 }}>
            <div className="form-grp">
              <label className="form-label">Method</label>
              <select className="innovic-select" value={f.rootCauseMethod} onChange={(e) => set('rootCauseMethod', e.target.value as UpdateCapaInput['rootCauseMethod'])}>
                {CAPA_RC_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <textarea className="innovic-input" rows={3} value={f.rootCause ?? ''} onChange={(e) => set('rootCause', e.target.value)} placeholder="Describe root cause…" />
        </Step>
        <Step n={3} title="Corrective Action">
          <textarea className="innovic-input" rows={3} value={f.correctiveAction ?? ''} onChange={(e) => set('correctiveAction', e.target.value)} placeholder="Actions taken to correct…" />
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
              <input type="date" className="innovic-input" value={f.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value)} />
            </div>
          </div>
        </Step>
        <Step n={4} title="Verification">
          <textarea className="innovic-input" rows={2} value={f.verification ?? ''} onChange={(e) => set('verification', e.target.value)} placeholder="Verify corrective action effectiveness…" />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <div className="form-grp">
              <label className="form-label">Verified By</label>
              <input className="innovic-input" value={f.verifiedBy ?? ''} onChange={(e) => set('verifiedBy', e.target.value)} placeholder="QC Head / Manager" />
            </div>
            <div className="form-grp">
              <label className="form-label">Verified Date</label>
              <input type="date" className="innovic-input" value={f.verifiedDate ?? ''} onChange={(e) => set('verifiedDate', e.target.value)} />
            </div>
          </div>
        </Step>
        <Step n={5} title="Preventive Action & Closure">
          <textarea className="innovic-input" rows={2} value={f.preventiveAction ?? ''} onChange={(e) => set('preventiveAction', e.target.value)} placeholder="Preventive action to stop recurrence…" />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <div className="form-grp">
              <label className="form-label">Effectiveness</label>
              <select className="innovic-select" value={f.effectiveness} onChange={(e) => set('effectiveness', e.target.value as UpdateCapaInput['effectiveness'])}>
                {CAPA_EFFECTIVENESS.map((e2) => (
                  <option key={e2 || 'none'} value={e2}>
                    {e2 || '— Not assessed —'}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Review Date</label>
              <input type="date" className="innovic-input" value={f.reviewDate ?? ''} onChange={(e) => set('reviewDate', e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Status</label>
              <select className="innovic-select" value={f.status} onChange={(e) => set('status', e.target.value as UpdateCapaInput['status'])}>
                {CAPA_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </Step>
      </fieldset>

      {err ? <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {readOnly ? 'Close' : 'Cancel'}
        </button>
        {!readOnly ? (
          <button type="button" className="btn btn-primary" disabled={update.isPending} onClick={() => void submit()}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save CAPA
          </button>
        ) : null}
      </div>
    </Overlay>
  );
}
