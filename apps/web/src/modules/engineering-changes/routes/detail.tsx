// Engineering Change detail (ADR-291).
//
//   DetailHeader (ECR No. · item · ECR Status · actions) → ClusterGrid facts
//   Impact table (dispositions while Waiting Approval)
//   Approvals table (Design / Quality / Production)
//
// Actions by status (the server decides each; the screen only hides):
//   Draft            Edit · Submit for Approval… (tick "Hold affected work") · Cancel ECR…
//   Waiting Approval Cancel ECR…  (sign-offs in the Approvals table)
//   Approved         Implement ECR… — needs all 3 sign-offs, the To Drawing Rev
//                    Released and no customer approval pending
//   Implemented      Close ECR… — once no hold of this ECR is left
// Every action carries the ECR's updatedAt (§20.4); 409 = someone acted first.

import {
  ECR_CLASSIFICATION_LABELS,
  ECR_CUSTOMER_APPROVAL_LABELS,
  REV_RELEASE_STATUSES,
  type Ecr,
  type RevReleaseStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { fmtDateTime } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { hardError, RefreshFailedNote } from '@/lib/refresh-failed-note';
import { useSaveKey } from '@/lib/use-save-key';
import { useSession } from '@/lib/session';
import { RevStatusBadge } from '@/modules/item-revisions/components/rev-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { CheckField, Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { DetailHeader, PageState } from '@/ui/layout';
import { useEcr, useEcrAction, useImplementEcr, useSubmitEcr } from '../api';
import { EcrApprovalsTable } from '../components/ecr-approvals-table';
import { EcrCancelDialog } from '../components/ecr-cancel-dialog';
import { EcrImpactTable } from '../components/ecr-impact-table';
import { EcrStatusBadge } from '../components/ecr-status-badge';

export const ecrDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ecrs/$id',
  component: EcrDetailPage,
});

const BACK_LABEL = 'Back to Engineering Change';

const isRevStatus = (s: string | null): s is RevReleaseStatus =>
  s != null && (REV_RELEASE_STATUSES as readonly string[]).includes(s);

/** Why Implement cannot run yet, or null. */
function implementBlock(ecr: Ecr): string | null {
  if (ecr.status !== 'approved') return 'Needs all three sign-offs first';
  if (ecr.customerApproval === 'pending') return 'Customer approval is still awaited';
  if (ecr.classification !== 'non_interchangeable' && ecr.toReleaseStatus !== 'released')
    return `Release ${ecr.toLabel ?? 'the new Drawing Rev'} in the Drawing Register first`;
  return null;
}

type Asking = 'submit' | 'implement' | 'close' | 'cancel' | null;

function EcrDetailPage(): React.JSX.Element {
  const { id } = ecrDetailRoute.useParams();
  const detailQuery = useEcr(id);
  const { data: ecr, isLoading, isError, error } = detailQuery;
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  const perms = effectiveFormPerms(eff, 'ecr_create');
  const saveKey = useSaveKey();
  const submit = useSubmitEcr(id, saveKey);
  const implement = useImplementEcr(id, saveKey);
  const close = useEcrAction('close');
  const [asking, setAsking] = useState<Asking>(null);
  const [hold, setHold] = useState(true);

  if (eff && !perms.view) return <PageState as="page" state="noaccess" />;
  if (isLoading) return <PageState state="loading" message="⟳ Loading ECR…" />;
  if (!ecr || hardError(detailQuery)) {
    return (
      <div>
        <Link to="/ecrs" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
          <Icon name="arrow-left" size={14} /> {BACK_LABEL}
        </Link>
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'ECR not found. Refresh the page.'}
        />
      </div>
    );
  }

  const isRaiser = !!me && ecr.createdBy === me.id;
  const mayWrite = perms.edit || (perms.entry && isRaiser);
  const open = ecr.status === 'draft' || ecr.status === 'submitted';
  const newItem = ecr.classification === 'non_interchangeable';
  const implBlock = implementBlock(ecr);
  const toNotReleased = !newItem && ecr.toLabel != null && ecr.toReleaseStatus !== 'released';

  return (
    <div>
      <RefreshFailedNote show={isError} />
      <DetailHeader
        backTo="/ecrs"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={ecr.code}
        name={ecr.itemCode ?? undefined}
        badges={<EcrStatusBadge status={ecr.status} />}
        actions={
          <>
            {ecr.status === 'draft' && mayWrite ? (
              <Link to="/ecrs/$id/edit" params={{ id: ecr.id }} className="btn btn-ghost btn-sm">
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            {ecr.status === 'draft' && mayWrite ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setAsking('submit')}
              >
                Submit for Approval…
              </button>
            ) : null}
            {ecr.status === 'approved' && perms.edit ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={implBlock !== null}
                title={implBlock ?? undefined}
                onClick={() => setAsking('implement')}
              >
                Implement ECR…
              </button>
            ) : null}
            {ecr.status === 'implemented' && perms.edit ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAsking('close')}
              >
                Close ECR…
              </button>
            ) : null}
            {open && mayWrite ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setAsking('cancel')}
              >
                Cancel ECR…
              </button>
            ) : null}
          </>
        }
      >
        <ClusterGrid stack>
          <Cluster name="Change" wide>
            <ClusterFact
              label="Item Code"
              value={ecr.itemCode ?? '—'}
              title={ecr.itemName ?? undefined}
              num
            />
            <ClusterFact label="Item Name" value={ecr.itemName ?? '—'} span={2} />
            <ClusterFact
              label="Change Type"
              value={ECR_CLASSIFICATION_LABELS[ecr.classification]}
            />
            <ClusterFact label="From Drawing Rev" value={ecr.fromLabel} num />
            {newItem ? (
              <ClusterFact label="Replacement Item" value={ecr.replacementItemCode ?? '—'} num />
            ) : (
              <ClusterFact label="To Drawing Rev" value={ecr.toLabel ?? '—'} num />
            )}
            <ClusterFact
              label="To Drawing Rev Status"
              value={
                newItem ? (
                  '—'
                ) : isRevStatus(ecr.toReleaseStatus) ? (
                  <RevStatusBadge status={ecr.toReleaseStatus} />
                ) : (
                  '—'
                )
              }
              empty={newItem || !isRevStatus(ecr.toReleaseStatus)}
            />
            <ClusterFact
              label="Approvals"
              value={`${ecr.approvals.filter((a) => a.decision === 'approved').length}/3`}
              num
            />
          </Cluster>
          <Cluster name="Customer" wide>
            <ClusterFact
              label="Customer Approval"
              value={ECR_CUSTOMER_APPROVAL_LABELS[ecr.customerApproval]}
            />
            <ClusterFact
              label="Customer Reference"
              value={ecr.customerApprovalRef ?? '—'}
              empty={!ecr.customerApprovalRef}
              span={2}
            />
            <ClusterFact label="Created By" value={ecr.createdByName ?? '—'} />
            <ClusterFact label="Created On" value={fmtDateTime(ecr.createdAt)} num />
            <ClusterFact label="Last Updated" value={fmtDateTime(ecr.updatedAt)} num span={3} />
          </Cluster>
          <Cluster name="Description">
            <ClusterFact label="Description of Change" value={ecr.description} wrap span={4} />
          </Cluster>
        </ClusterGrid>
      </DetailHeader>

      {toNotReleased && (ecr.status === 'submitted' || ecr.status === 'approved') ? (
        <Banner tone="warn">
          Release {ecr.toLabel} in the Drawing Register before Implement.{' '}
          {ecr.toItemRevisionId ? (
            <Link to="/drawings/$itemRevisionId" params={{ itemRevisionId: ecr.toItemRevisionId }}>
              Open {ecr.toLabel}
            </Link>
          ) : (
            <Link to="/drawing-register">Open Drawing Register</Link>
          )}
        </Banner>
      ) : null}
      {ecr.status === 'approved' && ecr.customerApproval === 'pending' ? (
        <Banner tone="warn">
          Customer approval is still awaited — record it before Implement.
        </Banner>
      ) : null}

      <EcrImpactTable ecr={ecr} canEdit={ecr.status === 'submitted' && mayWrite} />
      <EcrApprovalsTable ecr={ecr} />

      {asking === 'submit' ? (
        <ConfirmDialog
          tone="primary"
          title={`Submit ${ecr.code} for approval?`}
          message={
            <>
              <p>
                The ERP lists every SO / JWSO line, Job Card and stock of {ecr.fromLabel}, and
                Design, Quality and Production are asked to sign off.
              </p>
              <CheckField
                label="Hold affected work (operations not started yet stop until released)"
                checked={hold}
                onChange={setHold}
              />
            </>
          }
          confirmLabel="Submit ECR"
          pendingLabel="Submitting…"
          onCancel={() => setAsking(null)}
          onConfirm={async () => {
            await submit.mutateAsync({ expectedUpdatedAt: ecr.updatedAt, holdAffectedWork: hold });
            setAsking(null);
          }}
        />
      ) : null}
      {asking === 'implement' ? (
        <ConfirmDialog
          tone="primary"
          title={`Implement ${ecr.code}?`}
          message={
            newItem
              ? 'The ECR is marked implemented. No work moves: the replacement item is a new item code.'
              : `Each "Move not-started qty" row gets a new Production Order / Job Card on ${ecr.toLabel ?? 'the new Drawing Rev'}. Finished pieces stay on ${ecr.fromLabel}. Holds stay until each one is released.`
          }
          confirmLabel="Implement ECR"
          pendingLabel="Implementing…"
          onCancel={() => setAsking(null)}
          onConfirm={async () => {
            await implement.mutateAsync({ expectedUpdatedAt: ecr.updatedAt });
            setAsking(null);
          }}
        />
      ) : null}
      {asking === 'close' ? (
        <ConfirmDialog
          tone="primary"
          title={`Close ${ecr.code}?`}
          message="Closing is refused while any hold of this ECR is still on a Job Card operation."
          confirmLabel="Close ECR"
          pendingLabel="Closing…"
          onCancel={() => setAsking(null)}
          onConfirm={async () => {
            await close.mutateAsync({ id: ecr.id, expectedUpdatedAt: ecr.updatedAt });
            setAsking(null);
          }}
        />
      ) : null}
      {asking === 'cancel' ? (
        <EcrCancelDialog
          ecr={ecr}
          onDone={() => setAsking(null)}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}
