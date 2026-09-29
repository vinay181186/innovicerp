// The Item Issue slips behind a material view — each opens in the register.
import type { JcMaterial } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';

export function IssueSlipList({ issues }: { issues: JcMaterial['issues'] }): React.JSX.Element {
  if (issues.length === 0) return <></>;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="fw-700" style={{ fontSize: 12, marginBottom: 6 }}>
        Item Issues
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Issue No.</th>
              <th>Issue Date</th>
              <th>Items</th>
              <th>Issued To</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link
                    to="/issue-register"
                    search={{ tab: 'items', search: i.code }}
                    className="td-code"
                    style={{ color: 'var(--cyan)' }}
                  >
                    {i.code}
                  </Link>
                  {i.reversedAt ? (
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)' }}>
                      Reversed
                    </div>
                  ) : null}
                </td>
                <td className="text2" style={{ fontSize: 11 }}>
                  {fmtDate(i.issueDate)}
                </td>
                <td
                  className="mono fw-700"
                  style={{
                    color: 'var(--text)',
                    textDecoration: i.reversedAt ? 'line-through' : undefined,
                  }}
                >
                  {i.itemsSummary}
                </td>
                <td>{i.issuedTo || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
