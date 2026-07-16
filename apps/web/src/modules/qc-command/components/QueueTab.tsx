// QC Queue tab (legacy _qccRenderQueue L18667). Pending QC ops with age,
// attempt counter, due date, assignment, and Pick-Up / Assign actions.
// Sortable by age / due date / customer.

import type { QcCommandQueueRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

type Sort = 'age' | 'due' | 'customer';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'age', label: 'Oldest First' },
  { id: 'due', label: 'Due Date' },
  { id: 'customer', label: 'Customer' },
];

function fmt(d: string | null): string {
  return d ?? '—';
}

function attemptLabel(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}
function attemptColor(n: number): string {
  if (n === 1) return 'var(--green)';
  if (n === 2) return 'var(--amber)';
  return 'var(--red)';
}

export function QueueTab({
  rows,
  canPickUp,
  isAdmin,
  busyId,
  onPickUp,
  onAssign,
}: {
  rows: QcCommandQueueRow[];
  canPickUp: boolean;
  isAdmin: boolean;
  busyId: string | null;
  onPickUp: (jcOpId: string) => void;
  onAssign: (row: QcCommandQueueRow) => void;
}): React.JSX.Element {
  const [sort, setSort] = useState<Sort>('age');

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'age') return b.ageDays - a.ageDays;
    if (sort === 'due') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return (a.customer ?? '').localeCompare(b.customer ?? '');
  });

  const showActions = canPickUp || isAdmin;

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>QC Pending Items</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
          <span className="text3">Sort by:</span>
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn-ghost btn-sm"
              style={
                sort === s.id
                  ? {
                      fontSize: 11,
                      background: 'rgba(239,68,68,0.1)',
                      color: 'var(--red)',
                      border: '1px solid var(--red)',
                    }
                  : { fontSize: 11 }
              }
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legacy L18691 returns early on an empty queue: no panel, no table, no
          tip — just the sort bar and this line. */}
      {sorted.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--green)' }}>
          ✅ No pending QC items
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th>JC / Op</th>
                    <th>Operation</th>
                    <th>SO / Customer</th>
                    <th className="td-ctr">Qty</th>
                    <th className="td-ctr">Attempt</th>
                    <th>Due</th>
                    <th>Assigned To</th>
                    {showActions ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((it) => {
                    const ageColor =
                      it.ageDays >= 3
                        ? 'var(--red)'
                        : it.ageDays >= 1
                          ? 'var(--amber)'
                          : 'var(--green)';
                    return (
                      <tr
                        key={it.jcOpId}
                        style={it.isOverdue ? { background: 'rgba(239,68,68,0.04)' } : undefined}
                      >
                        <td
                          className="td-ctr mono fw-700"
                          style={{ color: ageColor, fontSize: 14 }}
                        >
                          {it.ageDays}d
                        </td>
                        <td className="td-code" style={{ color: 'var(--cyan)' }}>
                          {it.jcCode}{' '}
                          <span style={{ color: 'var(--red)', fontWeight: 700 }}>Op{it.opSeq}</span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <b style={{ color: 'var(--red)' }}>{it.operation}</b>
                          <br />
                          <span className="text3" style={{ fontSize: 10 }}>
                            {it.itemCode ?? '—'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <span style={{ color: 'var(--cyan)' }}>{it.soCode ?? '—'}</span>
                          <br />
                          <span className="text3" style={{ fontSize: 10 }}>
                            {it.customer ?? '—'}
                          </span>
                        </td>
                        <td
                          className="td-ctr mono fw-700"
                          style={{ color: 'var(--amber)', fontSize: 14 }}
                        >
                          {it.pendingQty}
                        </td>
                        <td className="td-ctr">
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '2px 10px',
                              borderRadius: 10,
                              background: 'rgba(0,0,0,0.05)',
                              color: attemptColor(it.attemptNo),
                            }}
                          >
                            {attemptLabel(it.attemptNo)}
                          </span>
                        </td>
                        <td
                          style={{
                            fontSize: 11,
                            color: it.isOverdue ? 'var(--red)' : 'var(--text3)',
                          }}
                        >
                          {fmt(it.dueDate)}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {it.assignedTo ? (
                            <span style={{ color: 'var(--blue)', fontWeight: 600 }}>
                              {it.assignedTo}
                            </span>
                          ) : (
                            <span className="text3">—</span>
                          )}
                        </td>
                        {showActions ? (
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {canPickUp ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ fontSize: 11, color: 'var(--green)' }}
                                  disabled={busyId === it.jcOpId}
                                  onClick={() => onPickUp(it.jcOpId)}
                                >
                                  {busyId === it.jcOpId ? (
                                    <Loader2 className="inline h-3 w-3 animate-spin" />
                                  ) : (
                                    '✋ Pick Up'
                                  )}
                                </button>
                              ) : null}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ fontSize: 11, color: 'var(--blue)' }}
                                  onClick={() => onAssign(it)}
                                >
                                  👤 Assign
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {showActions ? (
            <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
              💡 "Pick Up" assigns this item to you. "Assign" (admin only) allocates to any
              inspector. Attempt counter increments on rework.
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
