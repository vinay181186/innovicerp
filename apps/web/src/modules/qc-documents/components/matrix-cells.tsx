// Matrix view cell renderers (ADR-199). The fit table shows one COMPACT chip
// per QC op ('OK 12-Sep' / 'wait 40'); the full per-op detail (date, accepted,
// report-missing note, the ⬇ Download button) moves into the ▸ expand, per the
// ADR-199 decision #14 brief. Split out of routes/list.tsx.

import type { QcMatrixCell, QcMatrixRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { openStoragePath } from './qc-doc-shared';

/** Compact op-status chip for one matrix cell. */
export function MatrixOpChip({ cell }: { cell: QcMatrixCell }): React.JSX.Element {
  if (!cell.applicable) {
    return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>;
  }
  if (cell.done) {
    // Done but no report attached reads amber; a complete op with its report
    // reads green. The date rides along in both.
    const color = cell.hasDoc ? 'var(--green2)' : 'var(--amber2)';
    return (
      <span className="mono fw-700" style={{ color, fontSize: 11, whiteSpace: 'nowrap' }}>
        {cell.hasDoc ? 'OK' : 'OK*'} {fmtDate(cell.docDate, '')}
      </span>
    );
  }
  if (cell.pending) {
    return (
      <span className="mono fw-700" style={{ color: 'var(--amber2)', fontSize: 11 }}>
        wait {cell.qcPending}
      </span>
    );
  }
  return <span style={{ color: 'var(--text3)', fontSize: 11 }}>Waiting</span>;
}

/** Overall-status chip for the matrix row. */
export function OverallChip({ row }: { row: QcMatrixRow }): React.JSX.Element {
  if (row.overall === 'no_jc') {
    return <span style={{ color: 'var(--text3)', fontSize: 11 }}>No JC</span>;
  }
  if (row.overall === 'no_qc') {
    return <span style={{ color: 'var(--text3)', fontSize: 11 }}>No QC</span>;
  }
  if (row.overall === 'complete') {
    return (
      <span className="mono fw-700" style={{ color: 'var(--green2)', fontSize: 11 }}>
        ✅ {row.done}/{row.total}
      </span>
    );
  }
  return (
    <span className="mono fw-700" style={{ color: 'var(--amber2)', fontSize: 11 }}>
      {row.done}/{row.total}
    </span>
  );
}

/** Full per-op detail for the ▸ expand: the rich cell that used to live in the
 *  table body (status, date, accepted, report-missing, ⬇ Download). `maySave`
 *  gates only the download button, exactly as the old cell did. */
export function MatrixExpandedDetail({
  row,
  qcColumns,
  maySave,
}: {
  row: QcMatrixRow;
  qcColumns: string[];
  maySave: boolean;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {qcColumns.map((col, ci) => {
        const cell = row.cells[ci];
        if (!cell) return null;
        return (
          <div
            key={col}
            style={{
              minWidth: 150,
              padding: '8px 12px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green2)', marginBottom: 4 }}>
              {col}
            </div>
            <OpDetail cell={cell} maySave={maySave} />
          </div>
        );
      })}
    </div>
  );
}

function OpDetail({ cell, maySave }: { cell: QcMatrixCell; maySave: boolean }): React.JSX.Element {
  if (!cell.applicable) {
    return <div style={{ fontSize: 11, color: 'var(--text3)' }}>Not applicable</div>;
  }
  if (cell.done) {
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green2)' }}>✅ Completed</div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(cell.docDate, '')}</div>
        {cell.hasDoc ? (
          maySave && cell.storagePath ? (
            <button
              type="button"
              className="btn"
              style={{
                marginTop: 2,
                padding: '2px 8px',
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--green2)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (cell.storagePath) void openStoragePath(cell.storagePath);
              }}
            >
              ⬇ Download
            </button>
          ) : null
        ) : (
          <div style={{ fontSize: 11, color: 'var(--amber2)', fontStyle: 'italic' }}>
            Report Missing
          </div>
        )}
      </div>
    );
  }
  if (cell.pending) {
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber2)' }}>⏳ QC Pending</div>
        <div style={{ fontSize: 11, color: 'var(--amber2)' }}>{cell.qcPending} pcs</div>
        {cell.accepted > 0 ? (
          <div style={{ fontSize: 11, color: 'var(--green2)' }}>{cell.accepted} Accepted</div>
        ) : null}
      </div>
    );
  }
  return <div style={{ fontSize: 11, color: 'var(--text3)' }}>Waiting</div>;
}
