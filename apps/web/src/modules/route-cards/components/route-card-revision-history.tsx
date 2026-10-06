// ─── Revision history ─────────────────────────────────────────────────────
//
// Every revision has always carried a FULL snapshot of the operations as they
// stood at that revision — the server keeps it as JSON precisely so the trail
// survives the live op rows being wiped and rewritten on each save. The panel
// used to print the length of that array and nothing else, so the history could
// say Rev 2 held eight operations without saying what they were.
//
// Each row opens now. The colours and chips deliberately match the live
// operations table, so an old routing reads exactly like the current one.
//
// Rendered as the bare `.tbl-wrap` so it sits straight inside the Route Card
// detail's filling tab panel (it was its own stacked panel before).

import type { RouteCardRevision } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { fmtDate } from '@/lib/date';

// Group as the user reads it — never the raw code. The snapshot keeps no
// machine group, so an in-house op reads "In-house" here.
const OP_TYPE_LABEL: Record<string, string> = {
  process: 'In-house',
  outsource: 'OSP',
  qc: 'QC',
};

function opAccent(opType: string): string {
  return opType === 'qc'
    ? 'var(--green)'
    : opType === 'outsource'
      ? 'var(--purple)'
      : 'var(--text3)';
}

export function RouteCardRevisionHistory({
  revisions,
}: {
  revisions: RouteCardRevision[];
}): React.JSX.Element {
  // One revision open at a time. Two snapshots expanded in a single column read
  // as one long undifferentiated list, which is worse than showing neither.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            <th>Route Card Rev</th>
            <th>Revision Date</th>
            <th>Revised By</th>
            <th>Revision Note</th>
            <th className="th-num">Ops</th>
          </tr>
        </thead>
        <tbody>
          {revisions.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-state">
                No revisions yet.
              </td>
            </tr>
          ) : null}
          {revisions.map((rev) => {
            const open = openId === rev.id;
            return (
              <Fragment key={rev.id}>
                <tr
                  onClick={() => setOpenId(open ? null : rev.id)}
                  style={{ cursor: 'pointer' }}
                  title={open ? 'Hide the operations' : 'Show the operations at this revision'}
                >
                  <td className="text3">
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </td>
                  <td className="mono fw-700" style={{ color: 'var(--amber2)' }}>
                    Route Card Rev {rev.revisionNo}
                  </td>
                  <td className="text2" style={{ fontSize: 11 }}>
                    {fmtDate(rev.createdAt)}
                  </td>
                  <td className="text2" style={{ fontSize: 11 }}>
                    {rev.createdByName ?? '—'}
                  </td>
                  <td className="text2" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {rev.notes ?? '—'}
                  </td>
                  <td className="td-num mono">{rev.opsSnapshot.length}</td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--bg3)', padding: '8px 12px 12px' }}>
                      <div
                        className="text3"
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Routing at Route Card Rev {rev.revisionNo}
                      </div>
                      <div className="tbl-wrap">
                        <table className="innovic-table">
                          <thead>
                            <tr>
                              <th>Op</th>
                              <th>Group</th>
                              <th>Machine / Vendor</th>
                              <th>Operation</th>
                              <th className="th-num">Cycle Time (min)</th>
                              <th>Program No.</th>
                              <th className="th-num">Lead Days</th>
                              <th>Tool No.</th>
                              <th>Tool Details</th>
                              <th>Remarks</th>
                              <th>QC</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rev.opsSnapshot.map((op) => {
                              const accent = opAccent(op.opType);
                              return (
                                <tr key={`${rev.id}-${op.opSeq}`}>
                                  <td className="mono fw-700" style={{ color: accent }}>
                                    {opSrNo(op.opSeq)}
                                  </td>
                                  <td>
                                    <span
                                      className="badge"
                                      style={{ color: accent, fontWeight: 700 }}
                                    >
                                      {OP_TYPE_LABEL[op.opType] ?? op.opType}
                                    </span>
                                  </td>
                                  <td className="mono" style={{ fontSize: 12 }}>
                                    {op.opType === 'outsource'
                                      ? (op.ospVendorCode ?? '—')
                                      : (op.machineCode ?? '—')}
                                  </td>
                                  <td className="fw-700">{op.operation}</td>
                                  <td className="td-num mono">
                                    {op.opType === 'outsource'
                                      ? '—'
                                      : Number(op.cycleTimeMin) || '—'}
                                  </td>
                                  <td
                                    className="mono"
                                    style={{ fontSize: 12, color: 'var(--blue)' }}
                                  >
                                    {op.opType === 'outsource' ? '—' : (op.program ?? '—')}
                                  </td>
                                  <td className="td-num mono" style={{ fontSize: 12 }}>
                                    {op.opType === 'outsource' ? (op.ospLeadDays ?? '—') : '—'}
                                  </td>
                                  <td
                                    className="mono"
                                    style={{ fontSize: 12, color: 'var(--cyan)' }}
                                  >
                                    {op.toolNo ?? '—'}
                                  </td>
                                  <td className="text3" style={{ fontSize: 12 }}>
                                    {op.toolDetails ?? '—'}
                                  </td>
                                  {/* Optional like qcRequired below: a snapshot
                                      written before migration 0195 carries no
                                      remarks key at all. */}
                                  <td className="text2" style={{ fontSize: 12 }}>
                                    {op.remarks ?? '—'}
                                  </td>
                                  {/* undefined means this revision predates the
                                      QC flag being snapshotted. Shown as "not
                                      recorded" — never guessed as a No. */}
                                  <td
                                    style={{
                                      color:
                                        op.qcRequired === true ? 'var(--green)' : 'var(--text3)',
                                    }}
                                    title={
                                      op.qcRequired === undefined
                                        ? 'Not recorded — this revision predates QC being kept in the history'
                                        : undefined
                                    }
                                  >
                                    {op.qcRequired === undefined
                                      ? '—'
                                      : op.qcRequired
                                        ? 'Yes'
                                        : 'No'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
