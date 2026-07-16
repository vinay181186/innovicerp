// Alerts drill-down page (T-041d Phase A). Mirrors legacy `_alertDrillDown`
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L22374):
//   - modal title "🔔 <name> (<n> records)" (L22418) → the page `.section-hdr`
//   - header block: name · "dept · code" · "<n> records" in amber (L22419-22422)
//   - `.tbl-wrap > table` records table (L22423)
//
// Legacy rendered this as a `showModalLg` opened from the dashboard row; the
// port is a route (`/alerts/$code`). That divergence is deliberate.
//
// COLUMNS: legacy hard-codes a per-code column set inline (L22383-22416) and
// styles each cell by branch. The port drives columns from the server's
// `columns` array (registry definition per alert), so cell treatment here is
// keyed off `column.type` — the only per-column signal the payload carries.
// Several legacy columns are not sourceable from our payload at all; they are
// reported rather than fabricated. See the refactor report / ISSUE-088.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAlert } from '../api';
import { DEPT_LABEL } from '../lib/dept';

export const alertsDrillRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts/$code',
  component: AlertDrillPage,
});

function AlertDrillPage() {
  const { code } = alertsDrillRoute.useParams();
  const { data, isLoading, isError, error } = useAlert(code);

  const notFound = error?.message?.toLowerCase().includes('not found') ?? false;

  return (
    <div>
      {/* Header — legacy's modal title bar (L22418). The Back link has no legacy
          counterpart (the modal had a close button); kept as the port's only
          in-page route back to the dashboard. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔔 {data ? `${data.alert.name} (${data.alert.count} records)` : code}
        </div>
        <Link to="/alerts" className="btn btn-ghost" style={{ fontSize: 12 }}>
          ← Back to Alerts
        </Link>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state">
            <span style={{ color: 'var(--red)' }}>
              {notFound
                ? `No registered alert with code ${code}.`
                : (error?.message ?? 'Failed to load alert.')}
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* Header block — legacy L22419-22422. Legacy sets `color:var(--text1)`
              on the name span; `--text1` is undefined in legacy's own :root, so
              the text inherits the default colour. Reproduced by omitting it. */}
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--bg3)',
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 14,
            }}
          >
            <span style={{ fontWeight: 700 }}>{data.alert.name}</span>{' '}
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {DEPT_LABEL[data.alert.dept]} · {data.alert.code}
            </span>{' '}
            <span className="mono fw-700" style={{ color: 'var(--amber)', marginLeft: 8 }}>
              {data.alert.count} records
            </span>
          </div>

          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    {/* Legacy's drill headers are bare `<th>` in every branch —
                        no alignment, even over its centred qty cells. */}
                    {data.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.alert.records.length === 0 ? (
                    // No legacy counterpart: `_alertDrillDown` returns early on
                    // `!alert.count` (L22377) so the modal never opened empty.
                    // The route can be reached directly, so the state is kept.
                    <tr>
                      <td colSpan={data.columns.length} className="empty-state">
                        ✅ No records — alert is currently clear.
                      </td>
                    </tr>
                  ) : (
                    data.alert.records.map((row, i) => (
                      <tr key={`row-${i}`}>
                        {data.columns.map((c, ci) => {
                          const v = row[c.key];
                          const display =
                            v == null
                              ? ''
                              : c.type === 'number'
                                ? Number(v).toLocaleString()
                                : String(v);
                          // Legacy styles drill cells per code branch. Keyed off
                          // `type` here — the payload's only per-column signal:
                          //   first col  → `mono fw-700` + cyan (L22385 etc.)
                          //   number     → `td-ctr mono` (legacy's qty cells)
                          //   date       → font-size 11 (L22385)
                          return (
                            <td
                              key={c.key}
                              className={
                                ci === 0
                                  ? 'mono fw-700'
                                  : c.type === 'number'
                                    ? 'td-ctr mono'
                                    : undefined
                              }
                              style={
                                ci === 0
                                  ? { color: 'var(--cyan)' }
                                  : c.type === 'date'
                                    ? { fontSize: 11 }
                                    : undefined
                              }
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
