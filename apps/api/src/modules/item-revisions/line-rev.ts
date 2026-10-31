// Item + Drawing Rev on an SO / JWSO line — ONE hook for both line writers
// (sales-orders and job-work-orders: create insert and mergeLines; approved
// line edits replay through mergeLines, so they pass here too).
//
//   • resolveLineRevision — links the line to ABC/<rev> (lib/item-revision.ts
//     resolveItemRevision, the one writer of the register) and says what the
//     line's drawing copy should be.
//   • D1 (owner 2026-10-31) — a Rev change on a line that already has work:
//     OPEN Job Cards (and the line's plans / PROs) move to the new Rev; closed
//     Job Cards keep the old Rev; all Job Cards closed → refused. Same
//     transaction as the line save, Job Cards locked FOR UPDATE first.

import { ActivityAction, itemRevLabel, normalizeRevision } from '@innovic/shared';
import { inArray, sql } from 'drizzle-orm';
import { itemRevisionChanges, itemRevisions, items } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { findItemRevision, resolveItemRevision } from '../../lib/item-revision';
import { emitActivityLog } from '../activity-log/service';

export type LineKind = 'so' | 'jw';

export interface StoredLineRev {
  id: string;
  lineNo: number;
  itemId: string | null;
  revision: string | null;
  itemRevisionId: string | null;
  drawingFilePath: string | null;
}

export interface LineRevInput {
  kind: LineKind;
  /** The order (sales_orders.id / job_work_orders.id) and its code. */
  orderId: string;
  docCode: string;
  lineNo: number;
  /** Item and Rev the line will carry AFTER this save. */
  itemId: string | null;
  rev: string | null | undefined;
  /** The file field as sent: undefined = not sent, null = cleared. */
  sentFile: string | null | undefined;
  sentDrawingNo: string | null | undefined;
  /** The stored line, or null for a new line. */
  stored: StoredLineRev | null;
}

export interface LineRevResult {
  /** false = nothing about Item / Rev / file changed: leave the line as is. */
  touched: boolean;
  itemRevisionId: string | null;
  /** The line's drawing copy to store; undefined = keep today's behaviour. */
  drawingFilePath: string | null | undefined;
  /** The register's Drawing No., to fill a blank line Drawing No. only. */
  registerDrawingNo: string | null;
}

const norm = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
};

export async function resolveLineRevision(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  input: LineRevInput,
): Promise<LineRevResult> {
  const untouched: LineRevResult = {
    touched: false,
    itemRevisionId: input.stored?.itemRevisionId ?? null,
    drawingFilePath: undefined,
    registerDrawingNo: null,
  };
  const sourceType = input.kind === 'so' ? 'so_line' : 'jw_line';
  const sourceRef = `${input.docCode} ln ${input.lineNo}`;
  const sent = input.sentFile === undefined ? undefined : norm(input.sentFile);
  const st = input.stored;

  if (!st) {
    const r = await resolveItemRevision(tx, user, companyId, {
      itemId: input.itemId,
      rev: input.rev,
      drawingFilePath: sent ?? undefined,
      drawingNo: input.sentDrawingNo,
      sourceType,
      sourceRef,
    });
    if (!r)
      return {
        touched: true,
        itemRevisionId: null,
        drawingFilePath: undefined,
        registerDrawingNo: null,
      };
    return {
      touched: true,
      itemRevisionId: r.id,
      // A line offered no file gets the register's file (auto-fill).
      drawingFilePath: sent ?? r.drawingFilePath,
      registerDrawingNo: r.drawingNo,
    };
  }

  const itemChanged = (input.itemId ?? null) !== (st.itemId ?? null);
  const revChanged =
    input.rev !== undefined &&
    normalizeRevision(input.rev ?? '') !== normalizeRevision(st.revision ?? '');
  const storedFile = norm(st.drawingFilePath);
  const fileChanged = sent !== undefined && sent !== storedFile;
  if (!itemChanged && !revChanged && !fileChanged) return untouched;

  // A JWSO line raised by a server path stores the DB default '0' — nobody
  // typed it, so when this save does not send a Rev it is not registered.
  const rev =
    input.rev !== undefined
      ? input.rev
      : input.kind === 'jw' && normalizeRevision(st.revision ?? '') === '0'
        ? null
        : st.revision;
  let offered: string | undefined;
  let copied = false;
  if (fileChanged) {
    offered = sent ?? undefined;
  } else if ((revChanged || itemChanged) && sent && input.itemId) {
    // The form resent the line's current file with a new Rev. If ABC/<new>
    // already holds a file, the line takes that one; if not, this is "Use as
    // is" — the old Rev's file is carried to the new Rev ('copied').
    const target = await findItemRevision(tx, companyId, input.itemId, rev ?? '');
    if (!target?.drawingFilePath) {
      offered = sent;
      if (st.itemRevisionId) {
        const [old] = await tx
          .select({ drawingFilePath: itemRevisions.drawingFilePath })
          .from(itemRevisions)
          .where(inArray(itemRevisions.id, [st.itemRevisionId]))
          .limit(1);
        copied = old?.drawingFilePath === sent;
      }
    }
  }

  const r = await resolveItemRevision(tx, user, companyId, {
    itemId: input.itemId,
    rev,
    drawingFilePath: offered,
    drawingNo: input.sentDrawingNo,
    sourceType,
    sourceRef,
    copiedFromOtherRev: copied,
  });
  if (!r)
    return {
      touched: true,
      itemRevisionId: null,
      drawingFilePath: undefined,
      registerDrawingNo: null,
    };

  // A file the user cleared on purpose stays cleared on the line; otherwise
  // the line's copy follows the register (or what the user sent / nothing).
  let copy: string | null;
  if (fileChanged && sent === null) copy = null;
  else
    copy =
      r.drawingFilePath ??
      (sent !== undefined ? sent : revChanged || itemChanged ? null : storedFile);

  if (!itemChanged && st.itemRevisionId !== r.id) {
    await applyLineRevChange(tx, user, companyId, {
      kind: input.kind,
      orderId: input.orderId,
      docCode: input.docCode,
      lineId: st.id,
      lineNo: input.lineNo,
      itemId: input.itemId!,
      fromId: st.itemRevisionId,
      toId: r.id,
    });
  }
  return {
    touched: true,
    itemRevisionId: r.id,
    drawingFilePath: copy,
    registerDrawingNo: r.drawingNo,
  };
}

export interface LineRevChange {
  kind: LineKind;
  orderId: string;
  docCode: string;
  lineId: string;
  lineNo: number;
  itemId: string;
  fromId: string | null;
  toId: string;
}

/** D1 — move OPEN work of one line to the new Rev; closed Job Cards keep the
 *  old one; all closed → refuse. "Closed JC" = closed_at set, or v_jc_status
 *  'complete' / 'closed', or its PRO closed / short_closed. Cancelled JCs are
 *  soft-deleted (deleted_at) and so ignored. */
export async function applyLineRevChange(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  c: LineRevChange,
): Promise<{ movedDocs: string[]; keptDocs: string[] }> {
  const lineCol = c.kind === 'so' ? sql.raw('source_so_line_id') : sql.raw('source_jw_line_id');
  const planLineCol = c.kind === 'so' ? sql.raw('so_line_id') : sql.raw('jw_line_id');

  // Lock the line's Job Cards first (§20.3 — check and write under the lock).
  await tx.execute(sql`
    SELECT jc.id FROM public.job_cards jc
     WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
       AND jc.${lineCol} = ${c.lineId}::uuid AND jc.item_id = ${c.itemId}::uuid
     FOR UPDATE`);
  const jcs = (await tx.execute(sql`
    SELECT jc.id, jc.code,
           (jc.closed_at IS NOT NULL
             OR js.computed_status IN ('complete', 'closed')
             OR po.status IN ('closed', 'short_closed')) AS closed
      FROM public.job_cards jc
      LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
      LEFT JOIN public.production_orders po
        ON po.id = jc.production_order_id AND po.deleted_at IS NULL
     WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
       AND jc.${lineCol} = ${c.lineId}::uuid AND jc.item_id = ${c.itemId}::uuid
     ORDER BY jc.code`)) as unknown as Array<{ id: string; code: string; closed: boolean }>;

  const closed = jcs.filter((j) => j.closed);
  const open = jcs.filter((j) => !j.closed);
  if (jcs.length > 0 && open.length === 0) {
    throw new ValidationError(
      `Ln ${c.lineNo}: All Job Cards are closed — Rev and drawing locked. For a new Rev add a new line`,
    );
  }
  const closedIds = closed.map((j) => j.id);
  const closedArr =
    closedIds.length > 0
      ? sql`ARRAY[${sql.join(
          closedIds.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}]`
      : sql`ARRAY[]::uuid[]`;

  const movedDocs: string[] = [];
  if (open.length > 0) {
    await tx.execute(sql`
      UPDATE public.job_cards SET item_revision_id = ${c.toId}::uuid
       WHERE id IN (${sql.join(
         open.map((j) => sql`${j.id}::uuid`),
         sql`, `,
       )})`);
    movedDocs.push(...open.map((j) => j.code));
  }
  const plans = (await tx.execute(sql`
    UPDATE public.plans SET item_revision_id = ${c.toId}::uuid
     WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
       AND ${planLineCol} = ${c.lineId}::uuid AND item_id = ${c.itemId}::uuid
       AND (jc_id IS NULL OR NOT (jc_id = ANY(${closedArr})))
       AND item_revision_id IS DISTINCT FROM ${c.toId}::uuid
    RETURNING id, code`)) as unknown as Array<{ id: string; code: string }>;
  movedDocs.push(...plans.map((p) => p.code));
  if (plans.length > 0) {
    const pros = (await tx.execute(sql`
      UPDATE public.production_orders SET item_revision_id = ${c.toId}::uuid
       WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND plan_id IN (${sql.join(
           plans.map((p) => sql`${p.id}::uuid`),
           sql`, `,
         )})
         AND status NOT IN ('closed', 'short_closed')
         AND (job_card_id IS NULL OR NOT (job_card_id = ANY(${closedArr})))
      RETURNING code`)) as unknown as Array<{ code: string }>;
    movedDocs.push(...pros.map((p) => p.code));
  }
  const keptDocs = closed.map((j) => j.code);

  await tx.insert(itemRevisionChanges).values({
    companyId,
    soLineId: c.kind === 'so' ? c.lineId : null,
    jwLineId: c.kind === 'jw' ? c.lineId : null,
    fromItemRevisionId: c.fromId,
    toItemRevisionId: c.toId,
    movedDocs,
    keptDocs,
    createdBy: user.id,
    updatedBy: user.id,
  });

  const revIds = [c.toId, ...(c.fromId ? [c.fromId] : [])];
  const revRows = await tx
    .select({ id: itemRevisions.id, rev: itemRevisions.rev, code: items.code })
    .from(itemRevisions)
    .innerJoin(items, sql`${items.id} = ${itemRevisions.itemId}`)
    .where(inArray(itemRevisions.id, revIds));
  const lbl = (id: string | null): string => {
    const r = revRows.find((x) => x.id === id);
    return r ? itemRevLabel(r.code, r.rev) : '—';
  };
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: c.kind === 'so' ? 'SalesOrder' : 'JobWorkOrder',
      entityId: c.orderId,
      refId: c.docCode,
      lineRef: `Line ${c.lineNo}`,
      changes: [
        { field: 'drawingRev', label: 'Drawing Rev', before: lbl(c.fromId), after: lbl(c.toId) },
      ],
      detail:
        `Drawing Rev ${lbl(c.fromId)} → ${lbl(c.toId)} on ${c.docCode} ln ${c.lineNo}` +
        (movedDocs.length > 0 ? ` — moved ${movedDocs.join(', ')}` : '') +
        (keptDocs.length > 0 ? ` — kept (closed) ${keptDocs.join(', ')}` : ''),
    },
    companyId,
    user,
  );
  return { movedDocs, keptDocs };
}
