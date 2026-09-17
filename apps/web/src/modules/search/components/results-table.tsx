// Search results table — Date | Type | Doc No. | Party | Particulars | Qty | Status.
//
// Particulars renders `r.lines` ONE LINE EACH (a DC and a PO on the same row
// are two lines, never joined) and, when the API says what matched but that
// text is not already on the row, a last "matched: …" line. Rows open via
// `openSearchResult` — the single place that knows where each kind lives.
//
// Column widths live in the `.gs-results` rules (innovic-theme.css, "Global
// search" block): fixed layout so Particulars takes the slack and wraps, and
// the page never grows a sideways scrollbar at 1280px.

import { useNavigate } from '@tanstack/react-router';
import { GLOBAL_SEARCH_KIND_META } from '@innovic/shared';
import type { GlobalSearchResult } from '@innovic/shared';
import { GLOBAL_SEARCH_LANDING_KIND, openSearchResult } from '../api';

export const RESULT_COLUMNS = 7;

export function ResultsTable({
  items,
  body,
}: {
  items: GlobalSearchResult[];
  /** A single full-width state row (Searching… / error / no results) shown instead of `items`. */
  body?: React.ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="tbl-wrap gs-results">
      <table className="innovic-table">
        <colgroup>
          <col className="gs-col-date" />
          <col className="gs-col-type" />
          <col className="gs-col-docno" />
          <col className="gs-col-party" />
          <col />
          <col className="gs-col-qty" />
          <col className="gs-col-status" />
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Doc No.</th>
            <th>Party</th>
            <th>Particulars</th>
            <th>Qty</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {body ?? (
            <>
              {items.map((r) => {
                const landing = GLOBAL_SEARCH_LANDING_KIND.has(r.kind);
                return (
                  <tr
                    key={`${r.kind}:${r.id}`}
                    style={{ cursor: 'pointer' }}
                    title={landing ? 'Open in its register' : 'Open'}
                    onClick={() => {
                      openSearchResult(navigate, r);
                    }}
                  >
                    <td className="mono">{r.date ?? '—'}</td>
                    <td className="text3" style={{ fontSize: 12 }}>
                      {GLOBAL_SEARCH_KIND_META[r.kind].label}
                    </td>
                    <td className="gs-ellipsis">
                      <span
                        className="mono fw-700"
                        style={{ color: 'var(--text)' }}
                        title={r.docNo}
                      >
                        {r.docNo}
                      </span>
                    </td>
                    <td className="gs-ellipsis" title={r.party ?? undefined}>
                      {r.party ?? '—'}
                    </td>
                    <td className="gs-lines">
                      {r.lines.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                      {r.hit ? (
                        <div className="text3" style={{ fontSize: 12 }}>
                          matched: {r.hit}
                        </div>
                      ) : null}
                      {r.lines.length === 0 && !r.hit ? '—' : null}
                    </td>
                    <td className="mono">{r.qty ?? '—'}</td>
                    <td>
                      {r.status ? (
                        <span className="badge b-grey">{r.status.replaceAll('_', ' ')}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
