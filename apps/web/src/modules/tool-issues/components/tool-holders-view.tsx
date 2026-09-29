// Who holds what (ADR-193 phase 4b): every tool still out, grouped by holder,
// overdue flagged. Click a row to open its tool issue.
import { Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/date';
import { useToolHolders } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function ToolHoldersView({ onOpen }: { onOpen: (id: string) => void }): React.JSX.Element {
  const { data, isLoading, isError, error } = useToolHolders(true);
  if (isLoading)
    return (
      <div className="text3" style={{ fontSize: 12 }}>
        <Loader2 size={14} className="inline animate-spin" /> Loading…
      </div>
    );
  if (isError || !data)
    return (
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load holders.'}
      </div>
    );
  const holders = [...new Set(data.map((r) => r.holder))];
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Issued To</th>
              <th>Item Code</th>
              <th>Instrument Serial No.</th>
              <th className="th-num">Still Out</th>
              <th>Issue No.</th>
              <th>Expected Return</th>
            </tr>
          </thead>
          <tbody>
            {holders.flatMap((h) =>
              data
                .filter((r) => r.holder === h)
                .map((r, idx) => (
                  <tr
                    key={`${r.toolIssueId}`}
                    onClick={() => onOpen(r.toolIssueId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="fw-700">{idx === 0 ? h : ''}</td>
                    <td>
                      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {r.itemCode}
                      </span>
                      {r.itemName ? (
                        <div className="text3" style={{ fontSize: 11 }}>
                          {r.itemName}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {r.serialNos || '—'}
                    </td>
                    <td className="mono fw-700 td-num">{r3(r.stillOutQty)}</td>
                    <td className="td-code" style={{ color: 'var(--cyan)' }}>
                      {r.toolIssueCode}
                    </td>
                    <td style={{ color: r.isOverdue ? 'var(--red2)' : undefined }}>
                      {r.expectedReturnDate ? fmtDate(r.expectedReturnDate) : '—'}
                      {r.isOverdue ? ' · Overdue' : ''}
                    </td>
                  </tr>
                )),
            )}
            {data.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  No tools are out.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
