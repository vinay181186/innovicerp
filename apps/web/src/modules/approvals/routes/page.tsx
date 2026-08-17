// Settings → Approvals (ADR-130) — the things WAITING for a decision.
//
// Distinct from Approval Configuration next to it in the menu, which holds the
// rules (which approvals are on, who may approve, the PO limit). This screen
// holds the queue.
//
// Tabbed from the start so the other approval types have somewhere to land.
// Only "Log Entry" is wired today: PO and PR approvals live on their own
// detail screens, and the prApproval / invoiceApproval switches in Approval
// Configuration are currently read by no code at all.

import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { usePendingTimeChangeCount } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { LogEntryApprovals } from '../components/log-entry-approvals';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

type TabKey = 'log-entry' | 'purchase-orders' | 'purchase-requests';

function ApprovalsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canApprove = me?.role === 'admin' || me?.role === 'manager';
  const [tab, setTab] = useState<TabKey>('log-entry');
  const pendingLogEntry = usePendingTimeChangeCount(canApprove);

  if (!canApprove) {
    return (
      <div>
        <div className="section-hdr">✅ Approvals</div>
        <div className="panel">
          <div className="empty-state">
            Approving is limited to managers and admins. Your changes are sent here for one of them
            to decide.
          </div>
        </div>
      </div>
    );
  }

  const tabs: Array<{ key: TabKey; label: string; count?: number; enabled: boolean }> = [
    { key: 'log-entry', label: 'Log Entry', count: pendingLogEntry, enabled: true },
    { key: 'purchase-orders', label: 'Purchase Orders', enabled: false },
    { key: 'purchase-requests', label: 'Purchase Requests', enabled: false },
  ];

  return (
    <div>
      <div className="section-hdr">✅ Approvals</div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!t.enabled}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--cyan)' : 'transparent'}`,
                color: !t.enabled ? 'var(--text3)' : active ? 'var(--cyan)' : 'var(--text2)',
                fontWeight: active ? 700 : 500,
                fontSize: 12,
                padding: '8px 12px',
                cursor: t.enabled ? 'pointer' : 'default',
              }}
            >
              {t.label}
              {t.count ? (
                <span className="badge b-amber" style={{ marginLeft: 6 }}>
                  {t.count}
                </span>
              ) : null}
              {!t.enabled ? (
                <span className="text3" style={{ fontSize: 10, marginLeft: 4 }}>
                  (on the document)
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === 'log-entry' ? <LogEntryApprovals /> : null}
    </div>
  );
}
