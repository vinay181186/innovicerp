// The Route Card's Operation Sequence — the live routing, in op order.
//
// Rendered as the bare `.tbl-wrap` so it can sit straight inside a filling
// <Panel fill bodyPadding="none">: the panel takes the height left on the page
// and this box is what scrolls, with the header row held at the top
// (ADR-202 list-fill). Columns, colours and row tints are unchanged from the
// stacked-panel page this came out of.

import type { RouteCardOp } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';

export function RouteCardOpsTable({ ops }: { ops: RouteCardOp[] }): React.JSX.Element {
  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>Op</th>
            {/* Group replaces Type, as on the form: the kind of row is told
                by its tint and by the QC / OSP badge in this column. */}
            <th>Group</th>
            <th>Machine / Vendor</th>
            <th>Operation</th>
            <th className="th-num">Cycle Time (min)</th>
            <th>Program No.</th>
            <th className="th-num">Lead Days</th>
            <th>Tool No.</th>
            <th>Tool Details</th>
            {/* Migration 0195 — what the operator or the vendor must know
                about this ONE step. Long free text, so it ends in an
                ellipsis and the shared cell-overflow helper gives the whole
                sentence on hover. */}
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {ops.length === 0 ? (
            <tr>
              <td colSpan={10} className="empty-state">
                No operations yet.
              </td>
            </tr>
          ) : (
            ops.map((op) => {
              // Op-type accents follow legacy's own convention: the sequence
              // number is text3 on process rows (L10147/L10237), green on QC
              // (L10213) and purple on OSP (L10226).
              const accent =
                op.opType === 'qc'
                  ? 'var(--green)'
                  : op.opType === 'outsource'
                    ? 'var(--purple)'
                    : 'var(--text3)';
              const bg =
                op.opType === 'qc'
                  ? 'var(--green3)'
                  : op.opType === 'outsource'
                    ? 'var(--purple3)'
                    : undefined;
              // machTag (L1980) renders the machine as a cyan `.tag` chip:
              // code on a bold line, machine name on a 9px text3 line under
              // it. OSP/QC rows reuse the chip with their own accent.
              const tagColor =
                op.opType === 'qc'
                  ? 'var(--green)'
                  : op.opType === 'outsource'
                    ? 'var(--purple)'
                    : 'var(--cyan)';
              const tagCode =
                op.opType === 'outsource'
                  ? (op.ospVendorCode ?? op.ospVendorCodeText ?? '—')
                  : (op.machineCode ?? op.machineCodeText ?? '—');
              const tagName = op.opType === 'outsource' ? op.ospVendorName : op.machineName;
              // The machine GROUP ('VMC', 'CNC') is the word the shop floor
              // uses for a family of machines. It hangs off the machine, so
              // only an in-house op has one; OSP and QC rows show a badge in
              // the Group column instead.
              const groupCode =
                op.opType === 'outsource' || op.opType === 'qc' ? null : op.machineGroupCode;
              return (
                <tr key={op.id} style={{ background: bg }}>
                  {/* 10, 20, 30 on screen — display rule, see opSrNo */}
                  <td className="mono fw-700" style={{ color: accent }}>
                    {opSrNo(op.opSeq)}
                  </td>
                  <td>
                    {op.opType === 'qc' ? (
                      <span className="badge b-green" style={{ fontSize: 11 }}>
                        🔬 QC
                      </span>
                    ) : op.opType === 'outsource' ? (
                      <span
                        className="badge"
                        style={{
                          fontSize: 11,
                          color: 'var(--purple)',
                          background: 'var(--purple3)',
                          border: '1px solid var(--purple)',
                        }}
                      >
                        🏭 OSP
                      </span>
                    ) : groupCode ? (
                      <span className="mono fw-700" title={`Machine group: ${groupCode}`}>
                        {groupCode}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span
                      className="tag"
                      style={{
                        background: 'var(--bg4)',
                        color: tagColor,
                        lineHeight: 1.25,
                        verticalAlign: 'top',
                      }}
                    >
                      <span style={{ fontWeight: 700, display: 'block' }}>{tagCode}</span>
                      {tagName ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--text3)',
                            fontWeight: 400,
                            display: 'block',
                          }}
                        >
                          {tagName}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="fw-700">{op.operation}</td>
                  <td className="td-num mono">
                    {op.opType === 'outsource' ? '—' : Number(op.cycleTimeMin) || '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--blue)' }}>
                    {op.opType === 'outsource' ? '—' : (op.program ?? '—')}
                  </td>
                  <td className="td-num mono" style={{ fontSize: 12 }}>
                    {op.opType === 'outsource' ? (op.ospLeadDays ?? '—') : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
                    {op.toolNo ?? '—'}
                  </td>
                  <td className="text3" style={{ fontSize: 12 }}>
                    {op.toolDetails ?? '—'}
                  </td>
                  <td className="text2" style={{ fontSize: 12 }}>
                    {op.remarks ?? '—'}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
