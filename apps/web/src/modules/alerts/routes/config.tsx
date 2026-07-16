// Alert configuration (T-041d Phase A). Admin/manager-only — toggles
// per-rule on/off, persisted as alert_config rows. Mirrors legacy
// `renderAlertConfig` (legacy HTML L22427):
//   - `.section-hdr` "🔔 Alert Configuration" (L22446)
//   - `.panel > .tbl-wrap > table`: Active · Code · Department · Alert Name
//     (L22447-22449); `<th style="width:40px">` on Active
//   - checkbox `accent-color:var(--green)`, name cell dimmed to opacity .4
//     when inactive (L22438-22441)
//   - tip line (L22450)
// Legacy gated on `isAdmin()` and returned a bare `.empty-state`
// "⛔ Admin access required" (L22428); our service layer additionally allows
// `manager` to match the `manager_write` RLS policy — gate left as-is.
//
// Port-only beyond legacy's four columns: the rule `description` sub-line and
// the Status (override/default) column — both real server fields.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAlertConfig, useToggleAlert } from '../api';
import { DEPT_COLOR, DEPT_LABEL } from '../lib/dept';

export const alertsConfigRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts/config',
  component: AlertsConfigPage,
});

function AlertsConfigPage() {
  const { data: session } = useSession();
  const canEdit = session?.role === 'admin' || session?.role === 'manager';

  return (
    <div>
      {/* Header — legacy L22446 is a bare `.section-hdr`. The Back link has no
          legacy counterpart (legacy navigated from its sidebar); kept because
          it is the port's only in-page route back to the dashboard. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔔 Alert Configuration
        </div>
        <Link to="/alerts" className="btn btn-ghost" style={{ fontSize: 12 }}>
          ← Back to Alerts
        </Link>
      </div>

      {!canEdit ? (
        // Legacy L22428: bare `.empty-state` "⛔ Admin access required" (its
        // inline padding:40px is already the class default in our theme). The
        // role sentence below is ours — it is the only thing telling the user
        // why the table is hidden.
        <div className="empty-state">
          ⛔ Admin access required
          <div style={{ fontSize: 11, marginTop: 8 }}>
            Your role ({session?.role ?? 'unknown'}) cannot change alert configuration. The dashboard
            remains visible — only admin/manager can flip toggles.
          </div>
        </div>
      ) : (
        <ConfigTable />
      )}
    </div>
  );
}

function ConfigTable() {
  const { data, isLoading, isError, error } = useAlertConfig();
  const toggle = useToggleAlert();
  const [pending, setPending] = useState<string | null>(null);

  // Legacy read from an in-memory `db` and had no loading/error states; these
  // mirror the sibling dashboard's `.panel > .empty-state` shape.
  if (isLoading) {
    return (
      <div className="panel">
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="empty-state">
          <span style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load configuration.'}
          </span>
        </div>
      </div>
    );
  }

  const onToggle = (code: string, next: boolean) => {
    setPending(code);
    toggle.mutate(
      { code, active: next },
      {
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <>
      {/* Table — legacy L22447-22449. Legacy's zebra striping was an inline
          per-row background; our `.innovic-table tbody tr:nth-child(even) td`
          rule does the same job. */}
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>Active</th>
                <th>Code</th>
                <th>Department</th>
                <th>Alert Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.code}>
                  <td>
                    <input
                      type="checkbox"
                      checked={e.active}
                      disabled={pending === e.code}
                      onChange={(ev) => onToggle(e.code, ev.target.checked)}
                      style={{
                        width: 16,
                        height: 16,
                        accentColor: 'var(--green)',
                        cursor: pending === e.code ? 'wait' : 'pointer',
                      }}
                    />
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {e.code}
                  </td>
                  <td>
                    <span style={{ fontWeight: 700, color: DEPT_COLOR[e.dept] }}>
                      {DEPT_LABEL[e.dept]}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600, opacity: e.active ? 1 : 0.4 }}>
                    {e.name}
                    <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>
                      {e.description}
                    </div>
                  </td>
                  <td>
                    {e.isOverridden ? (
                      <span className="badge b-amber">override</span>
                    ) : (
                      <span className="badge b-grey">default</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tip — legacy L22450, minus its trailing clause "for users with
          department access". Legacy `renderAlerts` filtered rows through
          `_hasDeptAccess` (L22326); our `runAllAlerts` does not — every
          company member sees every active alert. The clause is dropped rather
          than copied so the page does not advertise a filter that is not
          wired up (see the dept-access gap raised against alerts/service.ts;
          fixing it is a backend authorization change, not a UI one). */}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
        💡 Toggle alerts on/off. Active alerts will show in Alerts Dashboard.
      </div>
    </>
  );
}
