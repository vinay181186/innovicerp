// ADR-291 — the ECR "Approvals" table: one row per sign-off (Design, Quality,
// Production) with its decision, who, when and the note. A user who may give
// a sign-off sees "Approve as <Role>" / "Reject as <Role>…" on that row (one
// label per control). The server re-checks the tier and the raiser rule on
// every call (POST /ecrs/:id/decide) and answers 409 when someone decided
// first; the refused row shows the server's words in a toast.

import {
  ECR_APPROVER_ROLES,
  ECR_APPROVER_ROLE_LABELS,
  type Ecr,
  type EcrApproval,
  type EcrApproverRole,
} from '@innovic/shared';
import { useState } from 'react';
import { fmtDateTime } from '@/lib/date';
import { useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { ApprovalRejectDialog } from '@/modules/approvals/components/approval-reject-dialog';
import { Badge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useToast } from '@/ui/feedback';
import { useDecideEcr } from '../api';
import { decideBlock, isPersonalBlock } from '../lib/ecr-rights';

interface Row {
  role: EcrApproverRole;
  approval: EcrApproval | null;
}

const dash = <span className="text3">—</span>;

export function EcrApprovalsTable({ ecr }: { ecr: Ecr }): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  const decide = useDecideEcr();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<EcrApproverRole | null>(null);
  const [busy, setBusy] = useState<EcrApproverRole | null>(null);

  const rows: Row[] = ECR_APPROVER_ROLES.map((role) => ({
    role,
    approval: ecr.approvals.find((a) => a.role === role) ?? null,
  }));

  const run = (role: EcrApproverRole, decision: 'approved' | 'rejected', note?: string): void => {
    if (busy) return;
    setBusy(role);
    const label = ECR_APPROVER_ROLE_LABELS[role];
    decide
      .mutateAsync({ id: ecr.id, role, decision, ...(note ? { note } : {}) })
      .then(() =>
        toast.ok(`${ecr.code}: ${decision === 'approved' ? 'approved' : 'rejected'} as ${label}`),
      )
      .catch((e: unknown) =>
        toast.error(`${ecr.code}: ${e instanceof Error ? e.message : 'Could not record it.'}`),
      )
      .finally(() => setBusy(null));
  };

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'role',
      kind: 'text',
      header: 'Sign-off',
      nowrap: true,
      render: (r) => <span className="fw-700">{ECR_APPROVER_ROLE_LABELS[r.role]}</span>,
    },
    {
      id: 'decision',
      kind: 'badge',
      header: 'Decision',
      nowrap: true,
      render: (r) =>
        r.approval ? (
          <Badge tone={r.approval.decision === 'approved' ? 'green' : 'red'}>
            {r.approval.decision === 'approved' ? 'Approved' : 'Rejected'}
          </Badge>
        ) : (
          <Badge tone="grey">Waiting</Badge>
        ),
    },
    {
      id: 'decided_by',
      kind: 'text',
      header: 'Decided By',
      nowrap: true,
      render: (r) => r.approval?.decidedByName ?? dash,
    },
    {
      id: 'decided_at',
      kind: 'date',
      header: 'Decided On',
      nowrap: true,
      render: (r) => (r.approval ? fmtDateTime(r.approval.decidedAt) : dash),
    },
    {
      id: 'note',
      kind: 'text',
      header: 'Decision Note',
      ellipsis: true,
      title: (r) => r.approval?.note ?? '',
      render: (r) => r.approval?.note ?? dash,
    },
  ];

  return (
    <Panel title="Approvals" bodyPadding="none">
      <DataTable
        tableKey={TABLE_KEYS.ecrApprovals}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.role}
        rowActions={(r) => {
          const block = decideBlock(ecr, r.role, eff, me?.id);
          if (block !== null) {
            return isPersonalBlock(block) ? <span className="text3">{block}</span> : null;
          }
          const label = ECR_APPROVER_ROLE_LABELS[r.role];
          if (busy === r.role) return <span className="text3">deciding…</span>;
          return (
            <div
              style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="btn btn-sm btn-success"
                disabled={busy !== null}
                onClick={() => run(r.role, 'approved')}
              >
                Approve as {label}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy !== null}
                onClick={() => setRejecting(r.role)}
              >
                Reject as {label}…
              </button>
            </div>
          );
        }}
      />
      {rejecting ? (
        <ApprovalRejectDialog
          title={`Reject ${ecr.code} as ${ECR_APPROVER_ROLE_LABELS[rejecting]}`}
          prompt="Reject Reason"
          confirmLabel={`Reject as ${ECR_APPROVER_ROLE_LABELS[rejecting]}`}
          placeholder="At least 5 characters. Rejecting lifts the holds this ECR put on the work."
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const role = rejecting;
            setRejecting(null);
            run(role, 'rejected', reason);
          }}
        />
      ) : null}
    </Panel>
  );
}
