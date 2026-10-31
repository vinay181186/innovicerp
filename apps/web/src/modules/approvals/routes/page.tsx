// Settings → Approvals — the things WAITING for a decision.
//
// Distinct from Approval Rules next to it in the menu, which holds the rules
// (which approvals are on, who may approve, the PO limit). This screen holds the
// queue.
//
// ONE UNIFORM structure for every document (owner decision). A FIXED tab row is
// ALWAYS shown, whatever each has waiting (the old row vanished a tab the moment
// its count hit 0): PO (the release inbox — PRs need no approval since
// 2026-10-31), then one edit tab per enrolled
// document type, then ONE Masters tab, then Op Entry. The edit tabs are BUILT
// from DOCUMENT_EDIT_ENTITIES / DOCUMENT_EDIT_LABEL (@innovic/shared), so a type
// the server stages can never again be missing here. Inside Masters a picker row
// chooses the master (DOCUMENT_EDIT_MASTER_ENTITIES). Every tab renders through
// the one shared shell (components/approval-tab.tsx): ListHeader(search) + a
// Pending / Approved / Rejected filter + DataTable + a VISIBLE row ✓ / ✗ + a ▸
// read-only detail. So PO, the edit tabs and Op Entry all look identical.
//
// Each tab's badge is its pending count (omitted at 0): PO / Op Entry from
// the approval inbox (ADR-190), the edit tabs from GET /document-edits/counts
// (ADR-202, now per-status so the in-tab filter carries counts too). The Masters
// badge is the sum of its masters' pending counts.

import {
  type AccessFormKey,
  CANCEL_DOC_FORM_KEY,
  CANCEL_DOC_TYPES,
  cancelDeciderRight,
  DOCUMENT_EDIT_ENTITIES,
  DOCUMENT_EDIT_LABEL,
  DOCUMENT_EDIT_MASTER_ENTITIES,
  type DocumentEditEntity,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDocumentEditCounts } from '@/modules/document-edits/api';
import { EditApprovalTab } from '@/modules/document-edits/components/doc-type-approvals';
import { useCancelRequests } from '@/modules/cancel-requests/api';
import { useApprovalInbox } from '../api';
import { CancelRequestApprovals } from '../components/cancel-request-approvals';
import { InboxApprovalTab } from '../components/inbox-approval-tab';
import { LogEntryApprovals } from '../components/log-entry-approvals';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

// The fixed tab set. Each tab is PO / Route Card (New) (the approval inbox), Op Entry (op-log
// time corrections), one enrolled edit document type, or the Masters tab (all
// enrolled masters behind one picker). Labels per docs/NAMING.md, from
// DOCUMENT_EDIT_LABEL (JWSO is the registered name for Job Work Order; Client →
// Customer, etc.).
type TabDef =
  | { key: 'po' | 'rc'; kind: 'inbox'; section: 'po' | 'rc'; label: string }
  | { key: 'logEntry'; kind: 'opEntry'; label: string }
  | { key: 'masters'; kind: 'masters'; label: string }
  | { key: 'cancel'; kind: 'cancel'; label: string }
  | { key: `doc:${DocumentEditEntity}`; kind: 'edit'; entity: DocumentEditEntity; label: string };

type MasterEntity = (typeof DOCUMENT_EDIT_MASTER_ENTITIES)[number];
const MASTER_SET: ReadonlySet<DocumentEditEntity> = new Set(DOCUMENT_EDIT_MASTER_ENTITIES);

// PO · Route Card (New) · (edit documents) · Masters · Op Entry — the order the
// owner named. No PR tab: PRs need no approval (owner rule 2026-10-31); an old
// pending PR edit or cancel still shows on its edit / Cancel Requests tab.
// PO is the stable default (always present), so the page never has to index an
// array.
const PO_TAB: TabDef = { key: 'po', kind: 'inbox', section: 'po', label: 'PO' };

const FIXED_TABS: TabDef[] = [
  PO_TAB,
  // ADR-253 — NEW Route Cards waiting for approval. Named apart from the
  // "Route Card" edit tab below (changes to an approved card).
  { key: 'rc', kind: 'inbox', section: 'rc', label: 'Route Card (New)' },
  ...DOCUMENT_EDIT_ENTITIES.filter((e) => !MASTER_SET.has(e)).map(
    (entity): TabDef => ({
      key: `doc:${entity}`,
      kind: 'edit',
      entity,
      label: DOCUMENT_EDIT_LABEL[entity],
    }),
  ),
  { key: 'masters', kind: 'masters', label: 'Masters' },
  { key: 'logEntry', kind: 'opEntry', label: 'Op Entry' },
  // ADR-235 — Cancel Requests for every enrolled document, one tab.
  { key: 'cancel', kind: 'cancel', label: 'Cancel Requests' },
];

/** The cancel-enrolled pages (ADR-235): Approve on any of them = may decide. */

/** A tab-style button with its amber pending badge (omitted at 0) — the tab row
 *  and the Masters picker share it so both read the same. */
function CountButton({
  label,
  on,
  n,
  onClick,
}: {
  label: string;
  on: boolean;
  n: number | undefined;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
      onClick={onClick}
    >
      {label}
      {n != null && n > 0 ? (
        <span className="badge b-amber" style={{ marginLeft: 6 }}>
          {n}
        </span>
      ) : null}
    </button>
  );
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-1)',
  flexWrap: 'wrap',
  minWidth: 0,
};

function ApprovalsPage(): React.JSX.Element {
  const { data: eff, isError: accessError } = useMyAccess();
  // ADR-232: Op Entry corrections are decided by whoever holds Approve on Op
  // Entry or on QC Submit in Access Control — the tick alone, no role.
  const canDecideLogEntry =
    effectiveFormPerms(eff, 'op_entry').approve || effectiveFormPerms(eff, 'qc_submit').approve;
  // ADR-235 — Cancel Requests are decided by the document page's deciding tick
  // (Approve; Edit for a one-step type such as PR — cancelDeciderRight, the
  // server's rule); the tab shows only to someone holding one.
  const canDecideCancel = CANCEL_DOC_TYPES.some(
    (t) => effectiveFormPerms(eff, CANCEL_DOC_FORM_KEY[t] as AccessFormKey)[cancelDeciderRight(t)],
  );
  // A one-row read for the tab badge: the server's total of waiting requests.
  const cancelCount = useCancelRequests(
    { status: 'pending', toDecide: 'true', limit: 1, offset: 0 },
    canDecideCancel,
  );
  const inbox = useApprovalInbox({ refetchOnMount: 'always' });
  const counts = inbox.data?.counts;
  const editCounts = useDocumentEditCounts();
  const editPendingByEntity = useMemo(() => {
    const m = new Map<DocumentEditEntity, number>();
    for (const c of editCounts.data?.counts ?? []) m.set(c.entity, c.pending);
    return m;
  }, [editCounts.data?.counts]);

  // The Op Entry tab is shown only to the users who may decide it; every other
  // tab is always present regardless of its count.
  const tabDefs = useMemo(
    () =>
      FIXED_TABS.filter(
        (t) =>
          (t.kind !== 'opEntry' || canDecideLogEntry) && (t.kind !== 'cancel' || canDecideCancel),
      ),
    [canDecideLogEntry, canDecideCancel],
  );

  const mastersPending = DOCUMENT_EDIT_MASTER_ENTITIES.reduce(
    (sum, e) => sum + (editPendingByEntity.get(e) ?? 0),
    0,
  );

  const pendingFor = (t: TabDef): number | undefined => {
    if (t.kind === 'edit') return editPendingByEntity.get(t.entity);
    if (t.kind === 'masters') return mastersPending;
    if (t.kind === 'opEntry') return counts?.logEntry;
    if (t.kind === 'cancel') return cancelCount.data?.total;
    return counts?.[t.section];
  };

  // Land ONCE on the first tab that has something waiting (PO first), so the
  // page opens on work rather than an empty list — resolved when both count
  // sources and the access check have answered, then stored as if picked. After that only a click
  // moves the tab: deciding a tab's last item must not jump the approver to
  // another tab (and lose their search / filter). Likewise the Masters picker
  // lands once on the first master with something waiting, else Item.
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedMaster, setPickedMaster] = useState<MasterEntity | null>(null);
  // Also waits for the access check, so the Op Entry tab (shown only to its
  // deciders) is in the row before the landing is chosen.
  const countsReady =
    counts !== undefined &&
    (editCounts.data !== undefined || editCounts.isError) &&
    (eff !== undefined || accessError);
  const landingKey =
    countsReady && picked === null
      ? (tabDefs.find((t) => (pendingFor(t) ?? 0) > 0) ?? PO_TAB).key
      : null;
  const landingMaster =
    countsReady && pickedMaster === null
      ? (DOCUMENT_EDIT_MASTER_ENTITIES.find((e) => (editPendingByEntity.get(e) ?? 0) > 0) ??
        DOCUMENT_EDIT_MASTER_ENTITIES[0])
      : null;
  useEffect(() => {
    if (landingKey !== null) setPicked(landingKey);
  }, [landingKey]);
  useEffect(() => {
    if (landingMaster !== null) setPickedMaster(landingMaster);
  }, [landingMaster]);

  const active: TabDef = tabDefs.find((t) => t.key === (picked ?? landingKey)) ?? PO_TAB;
  const activeMaster: MasterEntity =
    pickedMaster ?? landingMaster ?? DOCUMENT_EDIT_MASTER_ENTITIES[0];

  const tabRow = (
    <div role="tablist" aria-label="Approval type" style={ROW_STYLE}>
      {tabDefs.map((t) => (
        <CountButton
          key={t.key}
          label={t.label}
          on={t.key === active.key}
          n={pendingFor(t)}
          onClick={() => setPicked(t.key)}
        />
      ))}
    </div>
  );

  if (active.kind === 'masters') {
    const tabs = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0 }}>
        {tabRow}
        <div role="tablist" aria-label="Master" style={ROW_STYLE}>
          {DOCUMENT_EDIT_MASTER_ENTITIES.map((e) => (
            <CountButton
              key={e}
              label={DOCUMENT_EDIT_LABEL[e]}
              on={e === activeMaster}
              n={editPendingByEntity.get(e)}
              onClick={() => setPickedMaster(e)}
            />
          ))}
        </div>
      </div>
    );
    return <EditApprovalTab key={`doc:${activeMaster}`} entity={activeMaster} tabs={tabs} />;
  }

  if (active.kind === 'cancel') {
    return <CancelRequestApprovals key="cancel" tabs={tabRow} />;
  }
  if (active.kind === 'opEntry') {
    return <LogEntryApprovals key="logEntry" pendingCount={counts?.logEntry} tabs={tabRow} />;
  }
  if (active.kind === 'edit') {
    return <EditApprovalTab key={active.key} entity={active.entity} tabs={tabRow} />;
  }
  return (
    <InboxApprovalTab
      key={active.key}
      section={active.section}
      pendingCount={counts?.[active.section]}
      tabs={tabRow}
    />
  );
}
