// Approval Configuration page — admin-only.
//
// Mirror of legacy renderApprovalConfig (HTML L21608):
//   - PO Approval toggle + manager limit + approvers picker + flow diagram
//   - PR Approval (always ON — read-only)
//   - Invoice Approval toggle
//   - Recent Approval Activity (last 20 APPROVE / REJECT / PAYMENT rows)
//
// Save is one shot (legacy auto-saved on every change; we save explicitly
// to avoid 35 round-trips when an admin ticks every approver).

import type { ApprovalConfig, UserRole } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useUsersList } from '@/modules/users/api';
import { useApprovalConfig, useApprovalHistory, useSaveApprovalConfig } from '../api';

export const approvalConfigRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approval-config',
  component: ApprovalConfigPage,
});

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function fmtTs(ts: string): string {
  const dt = new Date(ts);
  return (
    dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

function ApprovalConfigPage(): React.JSX.Element {
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const { data: cfg, isLoading, isError, error } = useApprovalConfig();
  const { data: history } = useApprovalHistory();
  const { data: users } = useUsersList({ limit: 100, offset: 0 }, { enabled: isAdmin });
  const save = useSaveApprovalConfig();

  const [draft, setDraft] = useState<ApprovalConfig | null>(null);
  const [submitOk, setSubmitOk] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (cfg && !draft) setDraft({ ...cfg });
  }, [cfg, draft]);

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
          Admin access required for Approval Configuration.
        </div>
      </div>
    );
  }

  if (isLoading || !draft) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)', padding: 40 }}>
        {error instanceof Error ? error.message : 'Failed to load approval config'}
      </div>
    );
  }

  const approverSet = new Set(draft.poApprovers);
  const dirty =
    cfg &&
    (cfg.poApproval !== draft.poApproval ||
      cfg.poManagerLimit !== draft.poManagerLimit ||
      cfg.invoiceApproval !== draft.invoiceApproval ||
      cfg.poApprovers.join(',') !== draft.poApprovers.join(','));

  function toggleApprover(userId: string, role: UserRole): void {
    if (role === 'admin') return; // admins are always implicit approvers
    setDraft((prev) => {
      if (!prev) return prev;
      const set = new Set(prev.poApprovers);
      if (set.has(userId)) set.delete(userId);
      else set.add(userId);
      return { ...prev, poApprovers: Array.from(set) };
    });
  }

  async function onSave(): Promise<void> {
    if (!draft) return;
    setSubmitError(null);
    setSubmitOk(false);
    try {
      const saved = await save.mutateAsync(draft);
      setDraft({ ...saved });
      setSubmitOk(true);
      window.setTimeout(() => setSubmitOk(false), 3000);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          ⚖ Approval Configuration
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {submitOk ? (
            <span className="text2" style={{ fontSize: 11, color: 'var(--green)' }}>
              ✅ Saved
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || save.isPending}
            onClick={() => void onSave()}
          >
            {save.isPending ? (
              <>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>

      {submitError ? (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {submitError}
        </div>
      ) : null}

      {/* PO Approval block */}
      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
        >
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>🛒 Purchase Order Approval</span>
            <div className="text3" style={{ fontSize: 11 }}>
              When enabled, new POs are created as Draft and need Manager/Admin approval before printing.
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.poApproval}
              onChange={(e) => setDraft({ ...draft, poApproval: e.target.checked })}
              style={{ width: 20, height: 20 }}
            />
            <span style={{ fontWeight: 700, color: draft.poApproval ? 'var(--green)' : 'var(--text3)' }}>
              {draft.poApproval ? 'ENABLED' : 'DISABLED'}
            </span>
          </label>
        </div>

        <div
          style={{
            background: 'var(--bg3)',
            borderRadius: 8,
            padding: 12,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 10 }}>
            ₹ Amount Limits
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="text3" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                Manager can approve PO up to (₹)
              </label>
              <input
                type="number"
                value={draft.poManagerLimit}
                min={0}
                step={10000}
                onChange={(e) => setDraft({ ...draft, poManagerLimit: Number(e.target.value) || 0 })}
                style={{
                  width: '100%',
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--amber)',
                  padding: 8,
                  border: '2px solid var(--amber)',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  textAlign: 'right',
                }}
              />
              <div className="text3" style={{ fontSize: 10, marginTop: 4 }}>
                PO above this amount → only Admin can approve
              </div>
            </div>
            <div>
              <label className="text3" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                Admin approval limit
              </label>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', padding: 8 }}>
                Unlimited ∞
              </div>
            </div>
          </div>
        </div>

        {/* Approvers picker */}
        <div
          style={{
            background: 'var(--bg3)',
            borderRadius: 8,
            padding: 12,
            border: '1px solid var(--border)',
            marginTop: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>
            👤 PO Approvers (select users who can approve)
          </div>
          <div className="text3" style={{ fontSize: 10, marginBottom: 8 }}>
            Only selected users can approve/reject POs. Admin always has approval rights.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(users?.items ?? []).map((u) => {
              const isAdm = u.role === 'admin';
              const checked = isAdm || approverSet.has(u.id);
              return (
                <label
                  key={u.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 10px',
                    background: checked ? 'rgba(34,197,94,0.10)' : 'var(--bg)',
                    border: `1px solid ${checked ? 'var(--green)' : 'var(--border)'}`,
                    borderRadius: 6,
                    cursor: isAdm ? 'default' : 'pointer',
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isAdm}
                    onChange={() => toggleApprover(u.id, u.role)}
                    style={{ width: 16, height: 16 }}
                  />
                  <span
                    style={{
                      fontWeight: checked ? 700 : 400,
                      color: checked ? 'var(--green)' : 'var(--text2)',
                    }}
                  >
                    {u.fullName ?? u.email}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--text3)',
                      padding: '1px 5px',
                      background: 'var(--bg4)',
                      borderRadius: 3,
                    }}
                  >
                    {u.role}
                  </span>
                  {isAdm ? (
                    <span style={{ fontSize: 9, color: 'var(--green)' }}>(always)</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>

        {/* Flow diagram */}
        <div style={{ marginTop: 12, padding: 10, background: 'var(--bg3)', borderRadius: 6 }}>
          <div className="text3" style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
            FLOW:
          </div>
          {draft.poApproval ? (
            <div
              style={{
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ padding: '4px 10px', background: 'var(--bg4)', borderRadius: 4, fontWeight: 700 }}>
                PO Created
              </span>
              <span className="text3">→</span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'rgba(148,163,184,0.15)',
                  borderRadius: 4,
                  fontWeight: 700,
                  color: 'var(--text3)',
                }}
              >
                Draft
              </span>
              <span className="text3">→</span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'rgba(34,197,94,0.10)',
                  borderRadius: 4,
                  fontWeight: 700,
                  color: 'var(--green)',
                }}
              >
                ✅ Approve
              </span>
              <span className="text3">or</span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'rgba(239,68,68,0.10)',
                  borderRadius: 4,
                  fontWeight: 700,
                  color: 'var(--red)',
                }}
              >
                ❌ Reject
              </span>
              <span className="text3">→</span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'rgba(34,197,94,0.15)',
                  borderRadius: 4,
                  fontWeight: 700,
                  color: 'var(--green)',
                }}
              >
                Open (Active)
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ padding: '4px 10px', background: 'var(--bg4)', borderRadius: 4, fontWeight: 700 }}>
                PO Created
              </span>
              <span className="text3">→</span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'rgba(34,197,94,0.15)',
                  borderRadius: 4,
                  fontWeight: 700,
                  color: 'var(--green)',
                }}
              >
                Open (Active) — No approval needed
              </span>
            </div>
          )}
        </div>
      </div>

      {/* PR Approval — always on */}
      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>📋 Purchase Request Approval</span>
            <div className="text3" style={{ fontSize: 11 }}>
              PRs must be approved before PO can be created. This is always enabled.
            </div>
          </div>
          <span style={{ fontWeight: 700, color: 'var(--green)' }}>ALWAYS ON</span>
        </div>
      </div>

      {/* Invoice Approval */}
      <div className="panel" style={{ padding: 16, marginBottom: 14, opacity: 0.85 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>📄 Invoice Approval</span>
            <div className="text3" style={{ fontSize: 11 }}>
              Require approval before invoice can be printed and sent to client.
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.invoiceApproval}
              onChange={(e) => setDraft({ ...draft, invoiceApproval: e.target.checked })}
              style={{ width: 20, height: 20 }}
            />
            <span style={{ fontWeight: 700, color: draft.invoiceApproval ? 'var(--green)' : 'var(--text3)' }}>
              {draft.invoiceApproval ? 'ENABLED' : 'DISABLED'}
            </span>
          </label>
        </div>
      </div>

      {/* Approval History */}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          📜 Recent Approval Activity
        </div>
        {(history?.items ?? []).length === 0 ? (
          <div className="text3" style={{ fontSize: 11, padding: 10 }}>
            No approval activity yet.
          </div>
        ) : (
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Document</th>
                <th>Details</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {(history?.items ?? []).map((h) => {
                const color =
                  h.action === 'APPROVE' ? 'var(--green)' : h.action === 'REJECT' ? 'var(--red)' : 'var(--cyan)';
                return (
                  <tr key={h.id}>
                    <td style={{ fontSize: 11 }}>{fmtTs(h.ts)}</td>
                    <td style={{ fontWeight: 700, color, fontSize: 11 }}>{h.action}</td>
                    <td style={{ fontSize: 11, color: 'var(--cyan)' }}>{h.entity}</td>
                    <td className="text2" style={{ fontSize: 11 }}>{h.detail}</td>
                    <td style={{ fontSize: 11 }}>{h.userName ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 {inr(draft.poManagerLimit)} ₹ — managers approve up to this amount; admins always have full approval rights.
      </div>
    </div>
  );
}
