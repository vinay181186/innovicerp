// The Item Issue slips behind a material view — each opens in the register.
import type { JcMaterial } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';

export function IssueSlipList({ issues }: { issues: JcMaterial['issues'] }): React.JSX.Element {
  if (issues.length === 0) return <></>;
  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <div className="fw-700" style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}>
        Item Issues
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Issue No.</th>
              <th className="th-ctr">Issue Date</th>
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
                    <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--red)' }}>
                      Cancelled
                    </div>
                  ) : null}
                </td>
                <td className="td-ctr text2" style={{ fontSize: 'var(--fs-xs)' }}>
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
