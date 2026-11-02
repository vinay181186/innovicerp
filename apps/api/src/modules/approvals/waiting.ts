// ADR-265 — GET /approvals/waiting: ONE list of everything waiting for the
// CALLER's approval (contract: packages/shared/src/schemas/approvals-waiting.ts).
//
// It owns no approval rules. Each kind is read by the code its decide endpoint
// trusts, so a row here is one the caller's ✓ / ✗ would be accepted on:
//   po / rc / logEntry  readApprovalInbox (./service.ts — the old inbox read)
//   edit                pending document_edit_requests on the forms the caller
//                       holds Approve on (scope.ts), isStale by markStale and
//                       prices hidden by maskPriceChanges (document-edits)
//   cancel              typesWith(user, 'decide') + selectRows (cancel-requests)
//   dayLog              readDayLogApprovals (day-logs — L5 head rule, never self)
// Access checks open their own transactions, so each source resolves its access
// first and only then opens its read; the sources run side by side.

import {
  type DocumentEditEntity,
  type DocumentEditRow,
  type CancelDocType,
  type CancelRequestRow,
  docNavPage,
  opSrNo,
  WAITING_APPROVALS_LIMIT,
  type WaitingApprovalRow,
  type WaitingApprovalsResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { primeAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { CANCEL_HANDLERS } from '../cancel-requests/registry';
import { selectRows } from '../cancel-requests/rows';
import { entityHref } from '../dashboard/personal/util';
import { readDayLogApprovals } from '../day-logs/approvals';
import { maskPriceChanges, selectDocumentEditRows } from '../document-edits/helpers';
import { markStale } from '../document-edits/list';
import { approvableEditEntities, decidableCancelTypes } from './scope';
import { readApprovalInbox } from './service';
import { fmtDate } from '../../lib/format-date';
import {
  cancelRequestText,
  dayLogRequestText,
  editTypeKey,
  fieldsChangedText,
  timeChangeRequestText,
  orderedCounts,
  poRequestText,
  RC_REQUEST_TEXT,
  sortOldestFirst,
  toIso,
  typeLabelOf,
} from './waiting-text';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** The page a cancel request's document opens on: its edit-approval entity
 *  (the cancel registry's own link) through entityHref; null when none. */
export function cancelDocHref(
  docType: CancelDocType,
  docId: string,
  docCode: string,
): string | null {
  const entity = CANCEL_HANDLERS[docType]?.editEntity ?? null;
  return entity ? entityHref(entity, docId, docCode) : null;
}

/** Pending edit requests the caller may decide, stale-marked and price-masked. */
async function readEdits(
  user: AuthContext,
  companyId: string,
): Promise<{ entities: DocumentEditEntity[]; rows: DocumentEditRow[] }> {
  const entities = await approvableEditEntities(user);
  if (entities.length === 0) return { entities, rows: [] };
  const rows = await withUserContext(user, async (tx) => {
    const mine = await selectDocumentEditRows(tx, companyId, { status: 'pending', entities });
    await markStale(tx, companyId, mine);
    return mine;
  });
  // After the transaction: the price check reads access on its own.
  await maskPriceChanges(rows, user);
  return { entities, rows };
}

/** Pending cancel requests on the doc types the caller decides. */
async function readCancels(
  user: AuthContext,
  companyId: string,
): Promise<{ types: CancelDocType[]; rows: CancelRequestRow[] }> {
  const types = await decidableCancelTypes(user);
  if (types.length === 0) return { types, rows: [] };
  const rows = await withUserContext(user, (tx) =>
    selectRows(
      tx,
      companyId,
      sql`AND cr.status = 'pending' AND cr.doc_type IN (${sql.join(
        types.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    ),
  );
  return { types, rows };
}

/** The Day Log approvals. Someone who cannot open the Day Log page is refused
 *  there (and so by its approve endpoint too) — for this list: nothing. */
async function readDayLog(user: AuthContext): ReturnType<typeof readDayLogApprovals> {
  try {
    return await readDayLogApprovals(user);
  } catch (e) {
    if (e instanceof AuthorizationError) return { response: { rows: [] }, canApproveAny: false };
    throw e;
  }
}

const base = {
  itemCode: null,
  itemName: null,
  mode: 'direct' as const,
  changes: [],
  isStale: false,
  version: null,
};

export async function getWaitingApprovals(user: AuthContext): Promise<WaitingApprovalsResponse> {
  const companyId = requireCompany(user);
  // Fill the per-request access memo once, before the sources ask in parallel.
  await primeAccess(user);
  const [inbox, edits, cancels, dayLog] = await Promise.all([
    readApprovalInbox(user),
    readEdits(user, companyId),
    readCancels(user, companyId),
    readDayLog(user),
  ]);

  const rows: WaitingApprovalRow[] = [];
  for (const p of inbox.po) {
    rows.push({
      ...base,
      kind: 'po',
      id: p.id,
      typeKey: 'po',
      typeLabel: typeLabelOf('po'),
      docCode: p.docCode,
      docHref: p.navPage,
      request: poRequestText(p.docAmount),
      raisedByName: p.createdByName,
      raisedAt: toIso(p.createdAt),
    });
  }
  for (const r of inbox.rc) {
    rows.push({
      ...base,
      kind: 'rc',
      id: r.id,
      typeKey: 'rc',
      typeLabel: typeLabelOf('rc'),
      docCode: r.docCode,
      docHref: r.navPage,
      request: RC_REQUEST_TEXT,
      itemCode: r.itemCode,
      itemName: r.itemName,
      raisedByName: r.createdByName,
      raisedAt: toIso(r.createdAt),
      version: r.version,
    });
  }
  for (const { request: t, jobCardId } of inbox.logEntry) {
    rows.push({
      ...base,
      kind: 'logEntry',
      id: t.id,
      typeKey: 'logEntry',
      typeLabel: typeLabelOf('logEntry'),
      docCode: `${t.jobCardCode} · Op #${opSrNo(t.opSeq)}`,
      docHref: jobCardId ? docNavPage('job-card', jobCardId) : null,
      request: timeChangeRequestText(t),
      itemCode: t.itemCode,
      itemName: t.itemName,
      raisedByName: t.requestedByName ?? null,
      raisedAt: toIso(t.requestedAt),
    });
  }
  const editCount = new Map<string, number>();
  for (const e of edits.rows) {
    const decided = new Set(e.decisions.map((d) => d.changeId));
    const open = e.changes.filter((c) => !decided.has(c.id));
    if (open.length === 0) continue;
    const typeKey = editTypeKey(e.entity);
    editCount.set(typeKey, (editCount.get(typeKey) ?? 0) + 1);
    rows.push({
      ...base,
      kind: 'edit',
      id: e.id,
      typeKey,
      typeLabel: typeLabelOf(typeKey),
      docCode: e.docCode,
      docHref: entityHref(e.entity, e.entityId, e.docCode),
      request: fieldsChangedText(open.length),
      raisedByName: e.requestedByName,
      raisedAt: toIso(e.requestedAt),
      mode: 'review',
      changes: open,
      isStale: e.isStale,
    });
  }
  for (const c of cancels.rows) {
    rows.push({
      ...base,
      kind: 'cancel',
      id: c.id,
      typeKey: 'cancel',
      typeLabel: typeLabelOf('cancel'),
      docCode: c.docCode,
      docHref: cancelDocHref(c.docType, c.docId, c.docCode),
      request: cancelRequestText(c.docType, c.reason),
      raisedByName: c.requestedByName,
      raisedAt: toIso(c.requestedAt),
    });
  }
  for (const d of dayLog.response.rows) {
    rows.push({
      ...base,
      kind: 'dayLog',
      id: d.entryId,
      typeKey: 'dayLog',
      typeLabel: typeLabelOf('dayLog'),
      docCode: `${d.userName} · ${fmtDate(d.date)}`,
      docHref: null,
      request: dayLogRequestText(d.current, d.proposed),
      raisedByName: d.userName,
      raisedAt: toIso(d.requestedAt),
      version: d.requestedAt,
    });
  }

  const byType = new Map<string, number>([
    ['po', inbox.po.length],
    ['rc', inbox.rc.length],
    // The whole queue — the list itself stops at the inbox's own cap.
    ['logEntry', inbox.logEntryCount],
    ...editCount,
    ['cancel', cancels.rows.length],
    ['dayLog', dayLog.response.rows.length],
  ]);
  const counts = orderedCounts(byType);
  const total = counts.reduce((s, c) => s + c.n, 0);
  const canApprove =
    inbox.poAccess.canApprove ||
    inbox.rcAccess.canApprove ||
    inbox.canDecideLogEntry ||
    edits.entities.length > 0 ||
    cancels.types.length > 0 ||
    // Day Log heads only while an old edit waits (ADR-256 makes no new ones),
    // so an L5 / Super Admin with no Approve tick gets no empty Approvals item.
    dayLog.response.rows.length > 0;

  return {
    rows: sortOldestFirst(rows).slice(0, WAITING_APPROVALS_LIMIT),
    counts,
    total,
    canApprove,
  };
}
