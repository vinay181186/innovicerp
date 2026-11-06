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
// detail's tab panel (it was its own stacked panel before).

import type { RouteCardRevision } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { fmtDate, fmtTime12 } from '@/lib/date';
import { OpNotesAllToggle, OpNotesRow, OpNotesToggle, useOpNotes } from './rc-op-notes';

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
            <th className="th-ctr" style={{ width: 28 }} />
            <th className="th-ctr">Route Card Rev</th>
            <th className="th-ctr">Revision Date</th>
            <th className="th-ctr">Revision Time</th>
            <th>Revised By</th>
            <th>Revision Note</th>
            <th className="th-num">Ops</th>
          </tr>
        </thead>
        <tbody>
          {revisions.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-state">
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
                  <td className="td-ctr text3">
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--amber2)' }}>
                    Route Card Rev {rev.revisionNo}
                  </td>
                  <td className="td-ctr text2" style={{ fontSize: 'var(--fs-xs)' }}>
                    {fmtDate(rev.createdAt)}
                  </td>
                  <td className="td-ctr text2" style={{ fontSize: 'var(--fs-xs)' }}>
                    {fmtTime12(rev.createdAt, '—')}
                  </td>
                  <td className="text2" style={{ fontSize: 'var(--fs-xs)' }}>
                    {rev.createdByName ?? '—'}
                  </td>
                  <td
                    className="text2"
                    style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'pre-wrap' }}
                  >
                    {rev.notes ?? '—'}
                  </td>
                  <td className="td-num mono">{rev.opsSnapshot.length}</td>
                </tr>
                {open ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        background: 'var(--bg3)',
                        padding: 'var(--sp-2) var(--sp-3) var(--sp-3)',
                      }}
                    >
                      <div
                        className="text3"
                        style={{
                          fontSize: 'var(--fs-xs)',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Routing at Route Card Rev {rev.revisionNo}
                      </div>
                      <SnapshotOpsTable revision={rev} />
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

/** The routing kept with one revision. Its own component so Show / Hide has its own
 *  state for each opened revision. */
function SnapshotOpsTable({ revision }: { revision: RouteCardRevision }): React.JSX.Element {
  const noteOf = (op: RouteCardRevision['opsSnapshot'][number]) => ({
    id: String(op.opSeq),
    label: `operation ${opSrNo(op.opSeq)}`,
    toolDetails: op.toolDetails,
    // Optional like qcRequired below: a snapshot written before migration 0195
    // carries no remarks key at all.
    remarks: op.remarks,
  });
  const notes = useOpNotes(revision.opsSnapshot.map(noteOf));
  const columns = notes.any ? 10 : 9;
  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th className="th-ctr">Op</th>
            <th>Group</th>
            <th>Machine / Vendor</th>
            <th>Operation</th>
            <th className="th-num">Cycle Time (min)</th>
            <th>Program No.</th>
            <th className="th-num">Lead Days</th>
            <th>Tool No.</th>
            <th className="th-ctr">QC</th>
            {notes.any ? (
              <th className="th-ctr">
                <OpNotesAllToggle anyOpen={notes.anyOpen} onClick={notes.toggleAll} />
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {revision.opsSnapshot.map((op) => {
            const accent = opAccent(op.opType);
            const note = noteOf(op);
            const open = notes.isOpen(note);
            return (
              <Fragment key={op.opSeq}>
                <tr className={open ? 'rc-op-open' : undefined}>
                  <td className="td-ctr mono fw-700" style={{ color: accent }}>
                    {opSrNo(op.opSeq)}
                  </td>
                  <td>
                    <span className="badge" style={{ color: accent, fontWeight: 700 }}>
                      {OP_TYPE_LABEL[op.opType] ?? op.opType}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
                    {op.opType === 'outsource'
                      ? (op.ospVendorCode ?? '—')
                      : (op.machineCode ?? '—')}
                  </td>
                  <td className="rc-op-name fw-700">{op.operation}</td>
                  <td className="td-num mono">
                    {op.opType === 'outsource' ? '—' : Number(op.cycleTimeMin) || '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--blue)' }}>
                    {op.opType === 'outsource' ? '—' : (op.program ?? '—')}
                  </td>
                  <td className="td-num mono" style={{ fontSize: 'var(--fs-sm)' }}>
                    {op.opType === 'outsource' ? (op.ospLeadDays ?? '—') : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--cyan)' }}>
                    {op.toolNo ?? '—'}
                  </td>
                  {/* undefined means this revision predates the QC flag being
                      snapshotted. Shown as "not recorded" — never guessed as a No. */}
                  <td
                    className="td-ctr"
                    style={{ color: op.qcRequired === true ? 'var(--green)' : 'var(--text3)' }}
                    title={
                      op.qcRequired === undefined
                        ? 'Not recorded — this revision predates QC being kept in the history'
                        : undefined
                    }
                  >
                    {op.qcRequired === undefined ? '—' : op.qcRequired ? 'Yes' : 'No'}
                  </td>
                  {notes.any ? (
                    <td className="td-ctr">
                      {notes.hasNotes(note) ? (
                        <OpNotesToggle
                          open={open}
                          label={note.label}
                          onClick={() => notes.toggle(note)}
                        />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
                {open ? <OpNotesRow op={note} columns={columns} /> : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
