// Stock Count lines table (ADR-193 phase 2): In Stock now, In Stock at count
// (after Submit), Counted Qty, Difference, Reason. Counted Qty / Reason are
// editable only while the count is a draft.
import type { StockCountLine, StockCountStatus } from '@innovic/shared';
import { Trash2 } from 'lucide-react';
import type { DraftLine } from '../lib/draft-line';

export function StockCountLinesTable(props: {
  lines: DraftLine[];
  setLines: React.Dispatch<React.SetStateAction<DraftLine[]>>;
  saved: StockCountLine[];
  status: StockCountStatus;
  editable: boolean;
}): React.JSX.Element {
  const { lines, setLines, saved: savedLines, status, editable } = props;
  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th className="th-num">Ln</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th>UOM</th>
            <th className="th-num">In Stock now</th>
            {status !== 'draft' ? <th className="th-num">In Stock at count</th> : null}
            <th className="th-num">Counted Qty</th>
            <th className="th-num">Difference</th>
            <th>Reason</th>
            {editable ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const saved = savedLines.find((x) => x.itemId === l.itemId);
            const base = saved?.systemQtyAtCount ?? saved?.systemQtyNow ?? l.inStock;
            const counted = Number(l.countedQty);
            const diff =
              base != null && l.countedQty.trim() !== '' && Number.isFinite(counted)
                ? Math.round((counted - base) * 1000) / 1000
                : null;
            return (
              <tr key={l.itemId}>
                <td className="td-num mono">{i + 1}</td>
                <td className="mono fw-700" style={{ whiteSpace: 'nowrap' }}>
                  {l.itemCode}
                </td>
                <td>{l.itemName ?? '—'}</td>
                <td>{l.uom ?? '—'}</td>
                <td className="td-num mono">{saved?.systemQtyNow ?? l.inStock ?? '—'}</td>
                {status !== 'draft' ? (
                  <td className="td-num mono">{saved?.systemQtyAtCount ?? '—'}</td>
                ) : null}
                <td className="td-num">
                  {editable ? (
                    <input
                      className="innovic-input mono"
                      style={{ width: 110, textAlign: 'right' }}
                      type="number"
                      step="any"
                      min={0}
                      value={l.countedQty}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, countedQty: e.target.value } : x)),
                        )
                      }
                    />
                  ) : (
                    <span className="mono">{l.countedQty}</span>
                  )}
                </td>
                <td
                  className="td-num mono"
                  style={{
                    color:
                      diff == null || diff === 0
                        ? 'var(--text3)'
                        : diff > 0
                          ? 'var(--green)'
                          : 'var(--red)',
                  }}
                >
                  {diff == null ? '—' : diff > 0 ? `+${diff}` : diff}
                </td>
                <td>
                  {editable ? (
                    <input
                      className="innovic-input"
                      value={l.reason}
                      placeholder="e.g. found in bin B3"
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)),
                        )
                      }
                    />
                  ) : (
                    l.reason || '—'
                  )}
                </td>
                {editable ? (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Remove line"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
          {lines.length === 0 ? (
            <tr>
              <td colSpan={10} className="empty-state">
                Add items below or upload an Excel sheet (Item Code · Counted Qty · Reason).
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
