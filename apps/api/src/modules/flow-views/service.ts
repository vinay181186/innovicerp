// Flow views (requirement 3.5 "Make the flows visible", answers Problems 2.1–2.4).
//
// FOUR READ-ONLY views. Nothing here writes, and nothing here changes how a
// quantity is computed — every figure is read from the source the rest of the
// app already uses:
//
//   op flow      v_jc_op_status (0176) for Input / Completed / Accepted /
//                Available / status; op_log for the machine + QC rejects and
//                the LOG-NC-… rows an NC put back; GRN lines for the vendor's
//                accepted / rejected; nc_register for Lost with the SAME per-NC
//                rule as the view's op_loss CTE (closed scrap / make fresh →
//                rejected qty; rework / repair → failed qty).
//   rework tree  job_cards.parent_job_card_id / parent_nc_id + nc_register
//                cleared / failed.
//   NC timeline  the NC's own stamps (disposition_by/at, closed_by/at), its
//                challan (issued_by/at, received_by/at), rework child JC,
//                replacement GRNs, the LOG-NC op_log row, and activity_log for
//                the re-inspection user. `vendorOnly` is resolveNcSource — the
//                SAME test the dispose guard runs (nc-register/cascades.ts).
//   level matrix SO line → plans (lib/plan-order-coverage.ts Covered / Pending /
//                derived status) → production orders (Pending = the detail
//                view's remaining rule) → job cards (v_jc_status, per-op
//                v_jc_op_status) → OSP PR / PO / DC / GRN.
//
// Reads are company-scoped (withUserContext → RLS, plus an explicit
// company_id filter on the entry document).

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { canonicalActivityAction, NC_DISPOSITION_LABELS } from '@innovic/shared';
import { plans } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import {
  PLAN_COVERED_QTY_SQL,
  PLAN_PENDING_QTY_SQL,
  planDerivedStatusSql,
} from '../../lib/plan-order-coverage';
import { resolveNcSource } from '../nc-register/cascades';
import type {
  FlowNcRef,
  LevelJobCard,
  LevelMatrixResponse,
  LevelOspDoc,
  LevelPlan,
  LevelProductionOrder,
  LevelSoLine,
  NcTimelineResponse,
  NcTimelineStep,
  OpFlowResponse,
  OpFlowRow,
  ReworkTreeNode,
  ReworkTreeResponse,
} from './types';

type Row = Record<string, unknown>;

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

async function rows(tx: DbTransaction, q: SQL): Promise<Row[]> {
  return (await tx.execute(q)) as unknown as Row[];
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

function ncRefs(v: unknown): FlowNcRef[] {
  if (!Array.isArray(v)) return [];
  return (v as Row[]).map((r) => ({
    id: String(r['id']),
    code: String(r['code']),
    qty: num(r['qty']),
    disposition: str(r['disposition']),
    status: String(r['status'] ?? ''),
  }));
}

async function assertJobCard(
  tx: DbTransaction,
  jobCardId: string,
  companyId: string,
): Promise<{ code: string; orderQty: number }> {
  const r = await rows(
    tx,
    sql`SELECT code, order_qty FROM public.job_cards
        WHERE id = ${jobCardId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL`,
  );
  const jc = r[0];
  if (!jc) throw new NotFoundError('Job Card not found. Refresh the page.');
  return { code: String(jc['code']), orderQty: num(jc['order_qty']) };
}

// ─── 1. Op qty flow ──────────────────────────────────────────────────────────

/** Plain-words rule for the op's Passed On — mirrors the 0176 prev_output CASE. */
function passedOnRule(opType: string, qcRequired: boolean): string {
  if (opType === 'qc') return 'QC op: passes on what QC accepted';
  if (qcRequired) return 'Op with QC: passes on what QC accepted';
  if (opType === 'outsource') return 'Outsource op: passes on what was accepted from the vendor';
  return 'Plain op: passes on what was completed (plus any vendor-accepted balance)';
}

export async function getOpFlow(jobCardId: string, user: AuthContext): Promise<OpFlowResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const jc = await assertJobCard(tx, jobCardId, companyId);
    const r = await rows(
      tx,
      sql`
      WITH ops AS (
        SELECT o.id, o.op_seq, o.operation, o.op_type::text AS op_type, o.qc_required,
               o.outsource_sent_qty, o.outsource_po_line_id
        FROM public.jc_ops o
        WHERE o.job_card_id = ${jobCardId}::uuid AND o.deleted_at IS NULL
      ),
      -- 0179 — a reversal row carries the NEGATIVE qty / reject_qty of the
      -- entry it cancels, so every SUM below nets it with no filter (same as
      -- the view). A reversal of a LOG-NC row is matched through its original.
      lg AS (
        SELECT l.jc_op_id,
          SUM(CASE WHEN l.log_type = 'complete' THEN l.qty ELSE 0 END) AS completed_raw,
          SUM(CASE WHEN l.log_type = 'complete' THEN l.reject_qty ELSE 0 END) AS prod_rej,
          SUM(CASE WHEN l.log_type = 'qc' THEN l.reject_qty ELSE 0 END) AS qc_rej,
          SUM(CASE WHEN COALESCE(orig.log_no, l.log_no) LIKE 'LOG-NC-%' AND l.log_type IN ('complete', 'qc')
                   THEN l.qty ELSE 0 END) AS rw_back,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT CASE WHEN l.log_no LIKE 'LOG-NC-%' THEN SUBSTRING(l.log_no FROM 8) END), NULL) AS rw_from,
          COUNT(*) FILTER (WHERE l.reversal_of_id IS NOT NULL) AS reversed
        FROM public.op_log l
        JOIN ops ON ops.id = l.jc_op_id
        LEFT JOIN public.op_log orig ON orig.id = l.reversal_of_id
        GROUP BY l.jc_op_id
      ),
      opl AS (
        SELECT ops.id AS jc_op_id, ops.outsource_po_line_id AS pol
        FROM ops WHERE ops.outsource_po_line_id IS NOT NULL
        UNION
        SELECT l.jc_op_id, l.purchase_order_line_id
        FROM public.jc_op_po_lines l JOIN ops ON ops.id = l.jc_op_id
        WHERE l.deleted_at IS NULL
      ),
      osp AS (
        SELECT opl.jc_op_id,
          COALESCE(SUM(grl.qc_accepted_qty), 0) AS acc,
          COALESCE(SUM(grl.qc_rejected_qty), 0) AS rej,
          -- ADR-209: every receipt back from the vendor, incl. the GRN of a lot
          -- re-sent for rework (return-to-vendor) — "Received" on the table.
          COALESCE(SUM(grl.received_qty), 0) AS recv
        FROM opl
        LEFT JOIN public.goods_receipt_note_lines grl
          ON grl.purchase_order_line_id = opl.pol AND grl.deleted_at IS NULL
        GROUP BY opl.jc_op_id
      ),
      loss AS (
        SELECT nc.jc_op_id,
          SUM(CASE
                WHEN nc.status = 'closed' AND nc.disposition IN ('scrap', 'make_fresh') THEN nc.rejected_qty
                WHEN nc.disposition IN ('rework', 'repair') THEN nc.failed_qty
                ELSE 0
              END) AS lost,
          -- Vendor-rejected pieces sent back on a return-to-vendor challan and
          -- received again (NC rtv_sent / rtv_received), so the row reads
          -- 30 sent -> 25 ok + 5 back -> 5 returned -> 5 re-received.
          COALESCE(SUM(nc.rtv_sent_qty) FILTER (
            WHERE nc.disposition = 'return_to_vendor' AND nc.delivery_challan_id IS NOT NULL), 0) AS rtv_sent,
          COALESCE(SUM(nc.rtv_received_qty) FILTER (
            WHERE nc.disposition = 'return_to_vendor' AND nc.delivery_challan_id IS NOT NULL), 0) AS rtv_received,
          -- Same rule as v_jc_op_status returned_to_vendor.at_vendor_qty (open NCs).
          GREATEST(0, COALESCE(SUM(nc.rtv_sent_qty - nc.rtv_received_qty) FILTER (
            WHERE nc.disposition = 'return_to_vendor' AND nc.delivery_challan_id IS NOT NULL
              AND nc.status <> 'closed'), 0)) AS rtv_at_vendor,
          -- ADR-209: deviated pieces an NC recovered and that were accepted
          -- (rework / repair / use as is / return to vendor) — "Reworked".
          COALESCE(SUM(nc.cleared_qty), 0) AS cleared,
          -- Deviated pieces now back at the vendor or in its re-receipt QC
          -- (open return-to-vendor NCs): counted under At vendor / In QC, so
          -- not again as "deviated, NC open".
          GREATEST(0, COALESCE(SUM(nc.rtv_sent_qty - nc.cleared_qty - nc.failed_qty) FILTER (
            WHERE nc.disposition = 'return_to_vendor' AND nc.delivery_challan_id IS NOT NULL
              AND nc.status <> 'closed'), 0)) AS rtv_in_transit
        FROM public.nc_register nc
        JOIN ops ON ops.id = nc.jc_op_id
        WHERE nc.deleted_at IS NULL
        GROUP BY nc.jc_op_id
      ),
      ncs AS (
        SELECT nc.jc_op_id,
          JSON_AGG(JSON_BUILD_OBJECT(
            'id', nc.id, 'code', nc.code, 'qty', nc.rejected_qty,
            'disposition', nc.disposition, 'status', nc.status
          ) ORDER BY nc.nc_date, nc.code) AS list
        FROM public.nc_register nc
        JOIN ops ON ops.id = nc.jc_op_id
        WHERE nc.deleted_at IS NULL
        GROUP BY nc.jc_op_id
      )
      SELECT ops.id, ops.op_seq, ops.operation, ops.op_type, ops.qc_required,
        (ops.op_type = 'outsource' OR EXISTS (SELECT 1 FROM opl WHERE opl.jc_op_id = ops.id)
          OR ops.outsource_sent_qty > 0) AS has_osp,
        v.input_avail, v.completed_qty, v.qc_accepted_qty, v.available, v.qc_pending,
        v.computed_status, v.at_vendor_qty, v.in_qc_qty, v.rework_pending_qty,
        COALESCE(osp.recv, 0) AS osp_recv,
        COALESCE(loss.cleared, 0) AS cleared,
        COALESCE(loss.rtv_in_transit, 0) AS rtv_in_transit,
        COALESCE(loss.rtv_sent, 0) AS rtv_sent,
        COALESCE(loss.rtv_received, 0) AS rtv_received,
        COALESCE(loss.rtv_at_vendor, 0) AS rtv_at_vendor,
        -- v_jc_op_status counts return-to-vendor pieces in at_vendor_qty only on
        -- outsource ops / ops with the legacy PO link; a dual-lane op linked
        -- only through jc_op_po_lines gets them added here so At Vendor agrees
        -- with Returned to Vendor - Re-received on every row.
        (ops.op_type <> 'outsource' AND ops.outsource_po_line_id IS NULL) AS rtv_outside_view,
        COALESCE(lg.completed_raw, 0) AS completed_raw,
        COALESCE(lg.prod_rej, 0) AS prod_rej,
        COALESCE(lg.qc_rej, 0) AS qc_rej,
        COALESCE(lg.rw_back, 0) AS rw_back,
        COALESCE(lg.rw_from, '{}') AS rw_from,
        COALESCE(lg.reversed, 0) AS reversed,
        COALESCE(osp.acc, 0) AS osp_acc,
        COALESCE(osp.rej, 0) AS osp_rej,
        COALESCE(loss.lost, 0) AS lost,
        ops.outsource_sent_qty,
        ncs.list AS ncs
      FROM ops
      LEFT JOIN public.v_jc_op_status v ON v.jc_op_id = ops.id
      LEFT JOIN lg ON lg.jc_op_id = ops.id
      LEFT JOIN osp ON osp.jc_op_id = ops.id
      LEFT JOIN loss ON loss.jc_op_id = ops.id
      LEFT JOIN ncs ON ncs.jc_op_id = ops.id
      ORDER BY ops.op_seq`,
    );

    const ops: OpFlowRow[] = r.map((x) => {
      const opType = String(x['op_type']);
      const qcRequired = x['qc_required'] === true;
      const qcAccepted = num(x['qc_accepted_qty']);
      const ospAcc = num(x['osp_acc']);
      // Same CASE as v_jc_op_status prev_output (0176) — what the NEXT op
      // reads as its Input.
      const passedOn =
        qcRequired || opType === 'qc'
          ? qcAccepted
          : opType === 'outsource'
            ? ospAcc + qcAccepted
            : num(x['completed_raw']) + ospAcc;
      // ADR-209 — one reconciled row per op. Every piece that reached the op
      // (Input) is in exactly one place:
      //   Accepted + Rejected (final NC decision) + Deviated still open
      //   + At vendor + In QC + Pending  =  Input   -> Check ✓
      const isOut = opType === 'outsource';
      const hasOsp = x['has_osp'] === true;
      const deviated = num(x['prod_rej']) + num(x['qc_rej']) + num(x['osp_rej']);
      const reworked = num(x['cleared']);
      const rejectedFinal = num(x['lost']);
      const deviatedOpen = Math.max(
        0,
        deviated - reworked - rejectedFinal - num(x['rtv_in_transit']),
      );
      const atVendor =
        num(x['at_vendor_qty']) + (x['rtv_outside_view'] === true ? num(x['rtv_at_vendor']) : 0);
      const inQc = hasOsp ? num(x['in_qc_qty']) : 0;
      const qcWaiting = qcRequired && opType !== 'qc' ? num(x['qc_pending']) : 0;
      const pending =
        opType === 'qc'
          ? num(x['qc_pending'])
          : isOut
            ? Math.max(0, num(x['input_avail']) - num(x['outsource_sent_qty'])) + qcWaiting
            : Math.max(0, num(x['available']) - num(x['rework_pending_qty'])) + qcWaiting;
      const done =
        opType === 'qc'
          ? qcAccepted + num(x['qc_rej'])
          : isOut
            ? num(x['osp_recv'])
            : num(x['completed_raw']);
      const accounted = passedOn + rejectedFinal + deviatedOpen + atVendor + inQc + pending;
      const unaccounted = Math.round((num(x['input_avail']) - accounted) * 1000) / 1000;
      return {
        jcOpId: String(x['id']),
        opSeq: num(x['op_seq']),
        operation: String(x['operation'] ?? ''),
        opType,
        qcRequired,
        hasOsp: x['has_osp'] === true,
        inputQty: num(x['input_avail']),
        completedQty: num(x['completed_qty']),
        qcAcceptedQty: qcAccepted,
        productionRejectedQty: num(x['prod_rej']),
        qcRejectedQty: num(x['qc_rej']),
        vendorRejectedQty: num(x['osp_rej']),
        reworkedBackQty: num(x['rw_back']),
        reworkedBackFrom: Array.isArray(x['rw_from']) ? (x['rw_from'] as string[]) : [],
        reversedEntries: num(x['reversed']),
        lostQty: num(x['lost']),
        sentToVendorQty: num(x['outsource_sent_qty']),
        vendorAcceptedQty: ospAcc,
        returnedToVendorQty: num(x['rtv_sent']),
        reReceivedQty: num(x['rtv_received']),
        atVendorQty: atVendor,
        doneQty: done,
        acceptedQty: passedOn,
        deviatedQty: deviated,
        reworkedQty: reworked,
        rejectedFinalQty: rejectedFinal,
        deviatedOpenQty: deviatedOpen,
        pendingQty: pending,
        inQcQty: inQc,
        vendorSentQty: num(x['outsource_sent_qty']) + num(x['rtv_sent']),
        vendorReceivedQty: num(x['osp_recv']),
        unaccountedQty: unaccounted,
        passedOnQty: passedOn,
        availableQty: num(x['available']),
        qcPendingQty: num(x['qc_pending']),
        status: String(x['computed_status'] ?? ''),
        passedOnRule: passedOnRule(opType, qcRequired),
        ncs: ncRefs(x['ncs']),
      };
    });
    return { jobCardId, jobCardCode: jc.code, orderQty: jc.orderQty, ops };
  });
}

// ─── 2. Rework tree ──────────────────────────────────────────────────────────

export async function getReworkTree(
  jobCardId: string,
  user: AuthContext,
): Promise<ReworkTreeResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    await assertJobCard(tx, jobCardId, companyId);
    // Climb to the top card, then walk every descendant. Depth-capped so a
    // bad parent link can never loop.
    const r = await rows(
      tx,
      sql`
      WITH RECURSIVE up AS (
        SELECT j.id, j.parent_job_card_id, 0 AS d
        FROM public.job_cards j WHERE j.id = ${jobCardId}::uuid
        UNION ALL
        SELECT p.id, p.parent_job_card_id, up.d + 1
        FROM public.job_cards p JOIN up ON p.id = up.parent_job_card_id
        WHERE up.d < 20 AND p.company_id = ${companyId}::uuid AND p.deleted_at IS NULL
      ),
      root AS (SELECT id FROM up ORDER BY d DESC LIMIT 1),
      tree AS (
        SELECT j.id, NULL::uuid AS parent_id, 0 AS depth
        FROM public.job_cards j JOIN root ON root.id = j.id
        UNION ALL
        SELECT c.id, c.parent_job_card_id, t.depth + 1
        FROM public.job_cards c JOIN tree t ON c.parent_job_card_id = t.id
        WHERE c.deleted_at IS NULL AND t.depth < 20
      )
      SELECT t.id, t.parent_id, t.depth, j.code, j.recovery_kind, j.order_qty, j.origin_op_seq,
        s.computed_status,
        pnc.id AS pnc_id, pnc.code AS pnc_code, pnc.rejected_qty AS pnc_rejected,
        pnc.cleared_qty AS pnc_cleared, pnc.failed_qty AS pnc_failed, pnc.status AS pnc_status,
        (SELECT JSON_AGG(JSON_BUILD_OBJECT(
            'id', nc.id, 'code', nc.code, 'qty', nc.rejected_qty, 'disposition', nc.disposition,
            'status', nc.status, 'opSeq', nc.op_seq, 'childJobCardId', nc.child_job_card_id
          ) ORDER BY nc.nc_date, nc.code)
          FROM public.nc_register nc
          WHERE nc.job_card_id = t.id AND nc.deleted_at IS NULL) AS ncs
      FROM tree t
      JOIN public.job_cards j ON j.id = t.id
      LEFT JOIN public.v_jc_status s ON s.job_card_id = t.id
      LEFT JOIN public.nc_register pnc ON pnc.id = j.parent_nc_id AND pnc.deleted_at IS NULL
      ORDER BY t.depth, j.code`,
    );
    const nodes: ReworkTreeNode[] = r.map((x) => ({
      jobCardId: String(x['id']),
      code: String(x['code']),
      parentJobCardId: str(x['parent_id']),
      depth: num(x['depth']),
      recoveryKind: str(x['recovery_kind']),
      orderQty: num(x['order_qty']),
      status: str(x['computed_status']),
      originOpSeq: x['origin_op_seq'] == null ? null : num(x['origin_op_seq']),
      fromNc: x['pnc_id']
        ? {
            id: String(x['pnc_id']),
            code: String(x['pnc_code']),
            // The pieces sent to the child ARE the child's Order Qty.
            sentQty: num(x['order_qty']),
            clearedQty: num(x['pnc_cleared']),
            failedQty: num(x['pnc_failed']),
            status: String(x['pnc_status'] ?? ''),
          }
        : null,
      ncs: (Array.isArray(x['ncs']) ? (x['ncs'] as Row[]) : []).map((n) => ({
        id: String(n['id']),
        code: String(n['code']),
        qty: num(n['qty']),
        disposition: str(n['disposition']),
        status: String(n['status'] ?? ''),
        opSeq: n['opSeq'] == null ? null : num(n['opSeq']),
        childJobCardId: str(n['childJobCardId']),
      })),
    }));
    return { jobCardId, rootJobCardId: nodes[0]?.jobCardId ?? jobCardId, nodes };
  });
}

// ─── 3. NC timeline ──────────────────────────────────────────────────────────

const USER_NAME = (col: string): SQL =>
  sql.raw(
    `(SELECT COALESCE(NULLIF(u.full_name, ''), u.email) FROM public.users u WHERE u.id = ${col})`,
  );

export async function getNcTimeline(ncId: string, user: AuthContext): Promise<NcTimelineResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const ncRows = await rows(
      tx,
      sql`
      SELECT nc.*,
        -- date columns as text: postgres-js turns a DATE into a UTC-midnight Date.
        nc.nc_date::text AS nc_date_txt, nc.disposition_date::text AS disposition_date_txt,
        ${USER_NAME('nc.created_by')} AS created_by_name,
        ${USER_NAME('nc.disposition_by')} AS disposition_by_name,
        ${USER_NAME('nc.closed_by')} AS closed_by_name,
        (SELECT code FROM public.nc_register s WHERE s.id = nc.split_from_nc_id) AS split_from_code
      FROM public.nc_register nc
      WHERE nc.id = ${ncId}::uuid AND nc.company_id = ${companyId}::uuid AND nc.deleted_at IS NULL`,
    );
    const nc = ncRows[0];
    if (!nc) throw new NotFoundError('NC not found. Refresh the page.');
    const code = String(nc['code']);
    const steps: NcTimelineStep[] = [];

    // Activity rows for this NC — new rows carry entity_id, old ones only the
    // code in ref_id. Used for the user on steps the NC row does not stamp.
    const acts = await rows(
      tx,
      sql`
      SELECT a.ts, a.action, a.qty, a.detail,
        COALESCE(NULLIF(a.user_full_name, ''), ${USER_NAME('a.user_id')}, a.user_name) AS who
      FROM public.activity_log a
      WHERE a.company_id = ${companyId}::uuid
        AND (a.entity_id = ${ncId}::uuid OR (a.entity = 'NonConformance' AND a.ref_id = ${code}))
      ORDER BY a.ts`,
    );
    const actOf = (action: string): Row[] =>
      acts.filter((a) => canonicalActivityAction(String(a['action'])) === action);
    const firstUser = (action: string): string | null => str(actOf(action)[0]?.['who']);

    // 1. Raised
    const opTxt = nc['op_seq'] != null ? `Op ${num(nc['op_seq'])}` : null;
    const operation = str(nc['operation_text']) ?? str(nc['qc_operation_text']);
    steps.push({
      kind: 'raised',
      label: 'Raised',
      at: iso(nc['created_at']) ?? str(nc['nc_date_txt']),
      user: str(nc['created_by_name']) ?? firstUser('CREATE'),
      qty: num(nc['rejected_qty']),
      detail:
        [opTxt && operation ? `${opTxt}: ${operation}` : (opTxt ?? operation), str(nc['reason'])]
          .filter(Boolean)
          .join(' — ') || null,
      doc: null,
    });
    if (nc['split_from_nc_id']) {
      steps.push({
        kind: 'split',
        label: 'Split off',
        at: iso(nc['created_at']),
        user: str(nc['created_by_name']),
        qty: num(nc['rejected_qty']),
        detail: 'Part of a larger NC, split when only some pieces were decided',
        doc: {
          module: 'nc-register',
          id: String(nc['split_from_nc_id']),
          code: String(nc['split_from_code'] ?? ''),
        },
      });
    }

    // 2. Disposed
    const disposition = str(nc['disposition']);
    if (disposition) {
      const label =
        NC_DISPOSITION_LABELS[disposition as keyof typeof NC_DISPOSITION_LABELS] ?? disposition;
      const reworkOp =
        nc['rework_op_seq'] != null ? ` → back to Op ${num(nc['rework_op_seq'])}` : '';
      steps.push({
        kind: 'disposed',
        label: `Disposed: ${label}`,
        at: iso(nc['disposition_at']) ?? str(nc['disposition_date_txt']),
        user:
          str(nc['disposition_by_name']) ?? str(nc['disposition_by_text']) ?? firstUser('DISPOSE'),
        qty: num(nc['rejected_qty']),
        detail:
          [reworkOp ? reworkOp.slice(3) : null, str(nc['disposition_remarks'])]
            .filter(Boolean)
            .join(' — ') || null,
        doc: null,
      });
    }

    // 3a. Sent to vendor — the return challan.
    if (nc['delivery_challan_id']) {
      const dc = (
        await rows(
          tx,
          sql`SELECT d.id, d.code, d.dc_date::text AS dc_date, d.status, d.issued_at, d.received_at, d.created_at,
                COALESCE(${USER_NAME('d.issued_by')}, ${USER_NAME('d.created_by')}) AS issued_name,
                ${USER_NAME('d.received_by')} AS received_name
              FROM public.delivery_challans d
              WHERE d.id = ${String(nc['delivery_challan_id'])}::uuid`,
        )
      )[0];
      if (dc) {
        const dcDoc = {
          module: 'delivery-challans' as const,
          id: String(dc['id']),
          code: String(dc['code']),
        };
        steps.push({
          kind: 'sent_to_vendor',
          label: 'Sent to vendor',
          at: iso(dc['issued_at']) ?? str(dc['dc_date']),
          user: str(dc['issued_name']),
          qty: num(nc['rtv_sent_qty']),
          detail: String(dc['status']) === 'cancelled' ? 'Challan cancelled' : null,
          doc: dcDoc,
        });
        // Older challans were marked received before received_at existed (0178).
        if (dc['received_at'] || String(dc['status']) === 'received') {
          steps.push({
            kind: 'received',
            label: 'Received back on the challan',
            at: iso(dc['received_at']),
            user: str(dc['received_name']),
            qty: num(nc['rtv_received_qty']),
            detail: null,
            doc: dcDoc,
          });
        }
      }
    }

    // 3b. Rework / repair child job card.
    if (nc['child_job_card_id']) {
      const child = (
        await rows(
          tx,
          sql`SELECT j.id, j.code, j.order_qty, j.recovery_kind, j.created_at, j.closed_at,
                ${USER_NAME('j.created_by')} AS created_name
              FROM public.job_cards j WHERE j.id = ${String(nc['child_job_card_id'])}::uuid`,
        )
      )[0];
      if (child) {
        steps.push({
          kind: 'rework_jc',
          label:
            child['recovery_kind'] === 'repair' ? 'Repair job card made' : 'Rework job card made',
          at: iso(child['created_at']),
          user: str(child['created_name']),
          qty: num(child['order_qty']),
          detail: null,
          doc: { module: 'job-cards', id: String(child['id']), code: String(child['code']) },
        });
      }
    }

    // 4. Replacement / return GRNs raised against this NC.
    const grns = await rows(
      tx,
      sql`SELECT g.id, g.code, g.grn_date::text AS grn_date, g.created_at, ${USER_NAME('g.created_by')} AS created_name,
            COALESCE(SUM(l.received_qty), 0) AS received,
            COALESCE(SUM(l.qc_accepted_qty), 0) AS accepted,
            COALESCE(SUM(l.qc_rejected_qty), 0) AS rejected,
            MAX(l.qc_date)::text AS qc_date,
            (SELECT COALESCE(NULLIF(u.full_name, ''), u.email) FROM public.users u
              WHERE u.id = (ARRAY_AGG(l.qc_inspected_by) FILTER (WHERE l.qc_inspected_by IS NOT NULL))[1]) AS qc_name
          FROM public.goods_receipt_notes g
          LEFT JOIN public.goods_receipt_note_lines l
            ON l.goods_receipt_note_id = g.id AND l.deleted_at IS NULL
          WHERE g.nc_id = ${ncId}::uuid AND g.deleted_at IS NULL
          GROUP BY g.id
          ORDER BY g.grn_date, g.code`,
    );
    for (const g of grns) {
      const doc = {
        module: 'goods-receipt-notes' as const,
        id: String(g['id']),
        code: String(g['code']),
      };
      steps.push({
        kind: 'received',
        label: 'Received from vendor (GRN)',
        at: iso(g['created_at']) ?? str(g['grn_date']),
        user: str(g['created_name']),
        qty: num(g['received']),
        detail: null,
        doc,
      });
      if (num(g['accepted']) + num(g['rejected']) > 0) {
        steps.push({
          kind: 're_inspected',
          label: 'Re-inspected at Incoming QC',
          at: str(g['qc_date']),
          user: str(g['qc_name']),
          qty: num(g['accepted']) + num(g['rejected']),
          detail: `Accepted ${num(g['accepted'])} · Rejected ${num(g['rejected'])}`,
          doc,
        });
      }
    }

    // 5. Pieces put back on the op (LOG-NC-<code>).
    const back = await rows(
      tx,
      sql`SELECT l.log_no, l.log_date::text AS log_date, l.created_at, l.qty, o.op_seq, o.operation,
            ${USER_NAME('l.created_by')} AS created_name
          FROM public.op_log l JOIN public.jc_ops o ON o.id = l.jc_op_id
          WHERE l.log_no = ${`LOG-NC-${code}`} AND l.company_id = ${companyId}::uuid
          ORDER BY l.created_at`,
    );
    for (const b of back) {
      steps.push({
        kind: 'returned_to_op',
        label: `Returned to Op ${num(b['op_seq'])}: ${String(b['operation'] ?? '')}`,
        at: iso(b['created_at']) ?? str(b['log_date']),
        user: str(b['created_name']),
        qty: num(b['qty']),
        detail: `Entry ${String(b['log_no'])} — from rework ${code}`,
        doc: null,
      });
    }

    // 6. Re-inspection of a rework / repair recovery (no GRN): the QC rows the
    // recovery wrote on this NC.
    const cleared = num(nc['cleared_qty']);
    const failed = num(nc['failed_qty']);
    if (grns.length === 0 && cleared + failed > 0) {
      const qcActs = actOf('QC');
      if (qcActs.length > 0) {
        for (const a of qcActs) {
          steps.push({
            kind: 're_inspected',
            label: 'Re-inspected',
            at: iso(a['ts']),
            user: str(a['who']),
            qty: a['qty'] == null ? null : num(a['qty']),
            detail: str(a['detail']),
            doc: null,
          });
        }
      } else {
        steps.push({
          kind: 're_inspected',
          label: 'Re-inspected',
          at: null,
          user: null,
          qty: cleared + failed,
          detail: `Cleared ${cleared} · Rejected Again ${failed}`,
          doc: null,
        });
      }
    }

    // 7. Closed
    if (nc['closed_at'] || String(nc['status']) === 'closed') {
      steps.push({
        kind: 'closed',
        label: 'Closed',
        at: iso(nc['closed_at']),
        user: str(nc['closed_by_name']) ?? firstUser('CLOSE'),
        qty: null,
        detail: cleared + failed > 0 ? `Cleared ${cleared} · Rejected Again ${failed}` : null,
        doc: null,
      });
    }

    // Keep the recorded order; undated steps stay where the flow puts them.
    const source = await resolveNcSource(tx, companyId, {
      grnLineId: str(nc['grn_line_id']),
      jcOpId: str(nc['jc_op_id']),
    });
    return { ncId, code, vendorOnly: source.isVendorSourced, steps };
  });
}

// ─── 4. Level matrix ─────────────────────────────────────────────────────────

// Same EXISTS as plans/service.ts HAS_ROUTE_CARD_SQL (each module keeps its
// own copy — see lib/plan-order-coverage.ts planDerivedStatusSql).
const HAS_ROUTE_CARD_SQL = sql<boolean>`EXISTS (
  SELECT 1 FROM public.route_cards rc
  WHERE rc.company_id = ${plans.companyId}
    AND rc.item_id = ${plans.itemId}
    AND rc.deleted_at IS NULL
)`;

export async function getLevelMatrix(
  salesOrderId: string,
  user: AuthContext,
): Promise<LevelMatrixResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const so = (
      await rows(
        tx,
        sql`SELECT code FROM public.sales_orders
            WHERE id = ${salesOrderId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL`,
      )
    )[0];
    if (!so) throw new NotFoundError('Sales Order not found. Refresh the page.');

    // SO lines — Billed = Σ live invoice-line qty (same as the SO detail).
    const lineRows = await rows(
      tx,
      sql`SELECT sol.id, sol.line_no, COALESCE(i.code, sol.item_code_text) AS item_code, sol.part_name,
            sol.client_po_line_no, sol.order_qty, sol.dispatched_qty, sol.status, sol.short_closed_at,
            (SELECT COALESCE(SUM(il.qty), 0) FROM public.invoice_lines il
              JOIN public.invoices inv ON inv.id = il.invoice_id AND inv.deleted_at IS NULL
              WHERE il.sales_order_line_id = sol.id AND il.deleted_at IS NULL) AS billed
          FROM public.sales_order_lines sol
          LEFT JOIN public.items i ON i.id = sol.item_id
          WHERE sol.sales_order_id = ${salesOrderId}::uuid AND sol.deleted_at IS NULL
          ORDER BY sol.line_no`,
    );
    const lineIds = lineRows.map((l) => String(l['id']));
    if (lineIds.length === 0) return { salesOrderId, code: String(so['code']), lines: [] };

    // Plans — Covered / Pending / derived status from the ONE shared definition.
    const planRows = await tx
      .select({
        id: plans.id,
        code: plans.code,
        soLineId: plans.soLineId,
        planQty: plans.planQty,
        planStatus: plans.planStatus,
        covered: PLAN_COVERED_QTY_SQL,
        pending: PLAN_PENDING_QTY_SQL,
        derived: planDerivedStatusSql(HAS_ROUTE_CARD_SQL),
      })
      .from(plans)
      .where(
        and(
          inArray(plans.soLineId, lineIds),
          eq(plans.companyId, companyId),
          isNull(plans.deletedAt),
        ),
      )
      .orderBy(plans.code);
    const planIds = planRows.map((p) => p.id);

    const poRows =
      planIds.length > 0
        ? await rows(
            tx,
            sql`SELECT po.id, po.code, po.plan_id, po.status, po.order_qty, po.credited_qty, po.lost_qty
                FROM public.production_orders po
                WHERE po.plan_id = ANY(${sql.param(planIds)}::uuid[]) AND po.deleted_at IS NULL
                ORDER BY po.code`,
          )
        : [];
    const poIds = poRows.map((p) => String(p['id']));
    const poPlan = new Map(poRows.map((p) => [String(p['id']), String(p['plan_id'])]));
    const planLine = new Map(planRows.map((p) => [p.id, p.soLineId]));

    // Job cards: built by one of those orders, or raised straight on the line.
    // Rework / repair children are left out (they re-make pieces the parent
    // already counts — same rule as the SO detail's JC Qty).
    const jcRows = await rows(
      tx,
      sql`SELECT j.id, j.code, j.order_qty, j.production_order_id, j.source_so_line_id,
            s.computed_status
          FROM public.job_cards j
          LEFT JOIN public.v_jc_status s ON s.job_card_id = j.id
          WHERE j.company_id = ${companyId}::uuid AND j.deleted_at IS NULL
            AND j.recovery_kind IS NULL
            AND (j.production_order_id = ANY(${sql.param(poIds.length ? poIds : [salesOrderId])}::uuid[])
              OR j.source_so_line_id = ANY(${sql.param(lineIds)}::uuid[]))
          ORDER BY j.code`,
    );
    const jcIds = jcRows.map((j) => String(j['id']));

    const opRows =
      jcIds.length > 0
        ? await rows(
            tx,
            sql`SELECT o.job_card_id, o.op_seq, o.operation, o.op_type::text AS op_type, o.qc_required,
                  v.input_avail, v.completed_qty, v.qc_accepted_qty, v.computed_status
                FROM public.jc_ops o
                LEFT JOIN public.v_jc_op_status v ON v.jc_op_id = o.id
                WHERE o.job_card_id = ANY(${sql.param(jcIds)}::uuid[]) AND o.deleted_at IS NULL
                ORDER BY o.job_card_id, o.op_seq`,
          )
        : [];

    // OSP documents per card: the ops' PRs, their PO lines (legacy column,
    // link table, or PO line sourced from the op), the challans on those PO
    // lines or on the card, and the GRNs on those PO lines.
    const ospRows =
      jcIds.length > 0
        ? await rows(
            tx,
            sql`
            WITH ops AS (
              SELECT o.id, o.job_card_id, o.outsource_pr_id, o.outsource_po_line_id
              FROM public.jc_ops o
              WHERE o.job_card_id = ANY(${sql.param(jcIds)}::uuid[]) AND o.deleted_at IS NULL
            ),
            pol AS (
              SELECT ops.job_card_id, ops.outsource_po_line_id AS pol_id FROM ops
                WHERE ops.outsource_po_line_id IS NOT NULL
              UNION
              SELECT ops.job_card_id, l.purchase_order_line_id FROM public.jc_op_po_lines l
                JOIN ops ON ops.id = l.jc_op_id WHERE l.deleted_at IS NULL
              UNION
              SELECT ops.job_card_id, pl.id FROM public.purchase_order_lines pl
                JOIN ops ON ops.id = pl.source_jc_op_id WHERE pl.deleted_at IS NULL
            )
            SELECT DISTINCT ON (x.job_card_id, x.kind, x.id) x.* FROM (
              SELECT ops.job_card_id, 'pr' AS kind, pr.id, pr.code, pr.status::text AS status
              FROM ops JOIN public.purchase_requests pr
                ON (pr.id = ops.outsource_pr_id OR pr.source_jc_op_id = ops.id) AND pr.deleted_at IS NULL
              UNION ALL
              SELECT pol.job_card_id, 'po', po.id, po.code, po.status::text
              FROM pol JOIN public.purchase_order_lines pl ON pl.id = pol.pol_id
              JOIN public.purchase_orders po ON po.id = pl.purchase_order_id AND po.deleted_at IS NULL
              UNION ALL
              SELECT pol.job_card_id, 'dc', d.id, d.code, d.status::text
              FROM pol JOIN public.delivery_challan_lines dl
                ON dl.purchase_order_line_id = pol.pol_id AND dl.deleted_at IS NULL
              JOIN public.delivery_challans d ON d.id = dl.delivery_challan_id AND d.deleted_at IS NULL
              UNION ALL
              SELECT d.job_card_id, 'dc', d.id, d.code, d.status::text
              FROM public.delivery_challans d
              WHERE d.job_card_id = ANY(${sql.param(jcIds)}::uuid[]) AND d.deleted_at IS NULL
              UNION ALL
              SELECT g.job_card_id, 'grn', g.id, g.code,
                CASE WHEN g.any_pending THEN 'pending' WHEN g.any_progress THEN 'in_progress' ELSE 'completed' END
              FROM (
                SELECT pol.job_card_id, gr.id, gr.code,
                  BOOL_OR(gl.qc_status = 'pending') AS any_pending,
                  BOOL_OR(gl.qc_status = 'in_progress') AS any_progress
                FROM pol JOIN public.goods_receipt_note_lines gl
                  ON gl.purchase_order_line_id = pol.pol_id AND gl.deleted_at IS NULL
                JOIN public.goods_receipt_notes gr ON gr.id = gl.goods_receipt_note_id AND gr.deleted_at IS NULL
                GROUP BY pol.job_card_id, gr.id, gr.code
              ) g
            ) x
            ORDER BY x.job_card_id, x.kind, x.id`,
          )
        : [];

    const KIND_ORDER: Record<string, number> = { pr: 0, po: 1, dc: 2, grn: 3 };
    const jobCards: (LevelJobCard & { lineId: string | null })[] = jcRows.map((j) => {
      const id = String(j['id']);
      const poId = str(j['production_order_id']);
      const lineId =
        str(j['source_so_line_id']) ??
        (poId ? (planLine.get(poPlan.get(poId) ?? '') ?? null) : null);
      const ops = opRows
        .filter((o) => String(o['job_card_id']) === id)
        .map((o) => {
          const opType = String(o['op_type']);
          const qc = o['qc_required'] === true || opType === 'qc';
          return {
            opSeq: num(o['op_seq']),
            operation: String(o['operation'] ?? ''),
            inputQty: num(o['input_avail']),
            // Output as shown on the op card: accepted on a QC step, else completed.
            passedOnQty: qc ? num(o['qc_accepted_qty']) : num(o['completed_qty']),
            status: String(o['computed_status'] ?? ''),
          };
        });
      const ospDocs: LevelOspDoc[] = ospRows
        .filter((d) => String(d['job_card_id']) === id)
        .map((d) => ({
          kind: String(d['kind']) as LevelOspDoc['kind'],
          id: String(d['id']),
          code: String(d['code']),
          status: str(d['status']),
        }))
        .sort(
          (a, b) =>
            (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.code.localeCompare(b.code),
        );
      return {
        id,
        code: String(j['code']),
        orderQty: num(j['order_qty']),
        status: str(j['computed_status']),
        productionOrderId: poId,
        ops,
        ospDocs,
        lineId,
      };
    });

    const lines: LevelSoLine[] = lineRows.map((l) => {
      const id = String(l['id']);
      const linePlans: LevelPlan[] = planRows
        .filter((p) => p.soLineId === id)
        .map((p) => ({
          id: p.id,
          code: p.code,
          planQty: num(p.planQty),
          coveredQty: num(p.covered),
          pendingQty: num(p.pending),
          planStatus: String(p.planStatus),
          derivedStatus: p.derived ?? null,
        }));
      const planSet = new Set(linePlans.map((p) => p.id));
      const lineOrders: LevelProductionOrder[] = poRows
        .filter((p) => planSet.has(String(p['plan_id'])))
        .map((p) => {
          const status = String(p['status']);
          const orderQty = num(p['order_qty']);
          const credited = num(p['credited_qty']);
          const stopped = status === 'closed' || status === 'short_closed';
          return {
            id: String(p['id']),
            code: String(p['code']),
            planId: String(p['plan_id']),
            orderQty,
            creditedQty: credited,
            lostQty: num(p['lost_qty']),
            pendingQty: stopped ? 0 : Math.max(0, orderQty - credited),
            status,
          };
        });
      return {
        id,
        lineNo: num(l['line_no']),
        itemCode: str(l['item_code']),
        partName: String(l['part_name'] ?? ''),
        clientPoLineNo: str(l['client_po_line_no']),
        orderQty: num(l['order_qty']),
        dispatchedQty: num(l['dispatched_qty']),
        billedQty: num(l['billed']),
        status: String(l['status']),
        shortClosedAt: iso(l['short_closed_at']),
        plans: linePlans,
        productionOrders: lineOrders,
        jobCards: jobCards
          .filter((j) => j.lineId === id)
          .map(({ lineId: _lineId, ...rest }) => rest),
      };
    });

    return { salesOrderId, code: String(so['code']), lines };
  });
}
