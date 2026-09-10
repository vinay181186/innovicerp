// JC Operations service (Production slice D).
//
// Flat enriched-ops list across all JCs. Mirrors legacy renderJCOps
// (HTML L11349). Uses the v_jc_op_status view for status + qc + qty
// derivation; joins jobs/items/machines/vendors for display.

import { sql } from 'drizzle-orm';
import type {
  ChangeJcOpMachineInput,
  JcOpsBoardRow,
  ListJcOpsBoardQuery,
  ListJcOpsBoardResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { describeMachineSplit, loadMachineSplit } from '../../lib/machine-split';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function listJcOpsBoard(
  input: ListJcOpsBoardQuery,
  user: AuthContext,
): Promise<ListJcOpsBoardResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const jcFrag = input.jcCode ? sql`AND jc.code = ${input.jcCode}` : sql``;
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          jc.code ILIKE ${term}
          OR op.operation ILIKE ${term}
          OR i.code ILIKE ${term}
        )`
      : sql``;

    // cycle_time_min stored in minutes → convert to hours for legacy parity.
    // Pending hrs = (available pcs) * (cycle minutes / 60).
    const result = await tx.execute(sql`
      SELECT
        op.id AS "jcOpId",
        jc.id AS "jcId",
        jc.code AS "jcCode",
        i.code AS "jcItemCode",
        -- The customer's drawing revision for the JC's item, read live off the
        -- SO line the card was raised against — never items.revision, which
        -- describes the item master and means something else entirely. The sol
        -- join is LEFT: ops on JW-sourced and standalone cards are a normal
        -- part of this board and come back null. Cast to text because the
        -- contract types it as a string, while a database that has not had
        -- migration 0119 still holds an integer in that column; the cast is a
        -- no-op once 0119 is applied.
        sol.revision::text AS "itemRevision",
        i.name AS "jcItemName",
        jc.order_qty AS "jcOrderQty",
        op.op_seq AS "opSeq",
        op.operation,
        op.machine_id AS "machineId",
        COALESCE(m.code, op.machine_code_text) AS "machineCode",
        (COALESCE(op.cycle_time_min, 0) / 60.0)::numeric(10,3) AS "cycleTime",
        op.qc_required AS "qcRequired",
        op.op_type::text AS "opType",
        COALESCE(s.input_avail, 0)::int AS "inputAvail",
        COALESCE(s.completed_qty, 0)::int AS "completed",
        COALESCE(s.qc_accepted_qty, 0)::int AS "qcAccepted",
        COALESCE(s.qc_pending, 0)::int AS "qcPending",
        COALESCE(s.available, 0)::int AS "available",
        ROUND((COALESCE(op.cycle_time_min, 0) * COALESCE(s.available, 0) / 60.0)::numeric, 2) AS "pendingHrs",
        COALESCE(s.computed_status, 'waiting') AS "status",
        op.outsource_status::text AS "outsourceStatus",
        op.outsource_vendor_text AS "outsourceVendorCode",
        ven.name AS "outsourceVendorName",
        pr.code AS "outsourcePrCode",
        op.outsource_pr_id AS "outsourcePrId",
        po.code AS "outsourcePoCode",
        po.id AS "outsourcePoId",
        op.outsource_sent_qty AS "sentQty",
        -- The outward challan this op is still WAITING TO RECEIVE BACK: the
        -- oldest challan on the op's PO line that is still 'issued'. Drives the
        -- "Receive" next-action link on the op card. LATERAL + LIMIT 1 so the
        -- board stays one query at 2000 rows, not one lookup per op.
        --
        -- One op can carry several challans, and only the 'issued' ones are
        -- receivable: IN-JC-26-00008 op 8 has IN-DC-00002 (received),
        -- IN-DC-00006 (cancelled) and IN-DC-00007 (issued) on a single PO line,
        -- and only IN-DC-00007 may be received.
        odc.id AS "outsourceOpenDcId",
        odc.code AS "outsourceOpenDcCode",
        -- Who actually made the completed qty, per machine (0095 / ADR-126). The
        -- machine columns above are the op's CURRENT machine — where the
        -- REMAINING qty runs — so on a re-routed op they name a machine that
        -- may have produced nothing. This is the honest breakdown.
        COALESCE(mo.machines, '[]'::json) AS "machines"
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = op.machine_id AND m.deleted_at IS NULL
      LEFT JOIN public.vendors ven ON ven.id = op.outsource_vendor_id AND ven.deleted_at IS NULL
      LEFT JOIN public.purchase_requests pr ON pr.id = op.outsource_pr_id AND pr.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol ON pol.id = op.outsource_po_line_id AND pol.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      LEFT JOIN LATERAL (
        SELECT dc.id, dc.code
        FROM public.delivery_challan_lines dcl
        JOIN public.delivery_challans dc ON dc.id = dcl.delivery_challan_id
        WHERE dcl.purchase_order_line_id = op.outsource_po_line_id
          AND dc.company_id = ${companyId}::uuid
          AND dc.status = 'issued'
          AND dc.deleted_at IS NULL
          AND dcl.deleted_at IS NULL
        -- Oldest first: material comes back in the order it went out.
        ORDER BY dc.dc_date, dc.code
        LIMIT 1
      ) odc ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
                 ORDER BY v.completed_qty DESC, v.machine_code
               ) AS machines
        FROM public.v_op_machine_output v
        WHERE v.jc_op_id = op.id
      ) mo ON true
      WHERE op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
        ${jcFrag}
        ${searchFrag}
      ORDER BY jc.code, op.op_seq
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const items = (result as unknown as Array<Record<string, unknown>>).map(
      (r): JcOpsBoardRow => ({
        jcOpId: r['jcOpId'] as string,
        jcId: (r['jcId'] as string | null) ?? null,
        jcCode: String(r['jcCode'] ?? ''),
        jcItemCode: (r['jcItemCode'] as string | null) ?? null,
        itemRevision: (r['itemRevision'] as string | null) ?? null,
        jcItemName: (r['jcItemName'] as string | null) ?? null,
        jcOrderQty: num(r['jcOrderQty']),
        opSeq: num(r['opSeq']),
        operation: String(r['operation'] ?? ''),
        machineId: (r['machineId'] as string | null) ?? null,
        machineCode: (r['machineCode'] as string | null) ?? null,
        machines: (
          (r['machines'] as Array<{ machineCode: string; qty: unknown }> | null) ?? []
        ).map((v) => ({ machineCode: String(v.machineCode), qty: num(v.qty) })),
        cycleTime: num(r['cycleTime']),
        qcRequired: Boolean(r['qcRequired']),
        opType: String(r['opType'] ?? 'process'),
        inputAvail: num(r['inputAvail']),
        completed: num(r['completed']),
        qcAccepted: num(r['qcAccepted']),
        qcPending: num(r['qcPending']),
        available: num(r['available']),
        pendingHrs: num(r['pendingHrs']),
        status: String(r['status'] ?? 'waiting'),
        outsourceStatus: (r['outsourceStatus'] as string | null) ?? null,
        outsourceVendorCode: (r['outsourceVendorCode'] as string | null) ?? null,
        outsourceVendorName: (r['outsourceVendorName'] as string | null) ?? null,
        outsourcePrCode: (r['outsourcePrCode'] as string | null) ?? null,
        outsourcePrId: (r['outsourcePrId'] as string | null) ?? null,
        outsourcePoCode: (r['outsourcePoCode'] as string | null) ?? null,
        outsourcePoId: (r['outsourcePoId'] as string | null) ?? null,
        outsourceOpenDcId: (r['outsourceOpenDcId'] as string | null) ?? null,
        outsourceOpenDcCode: (r['outsourceOpenDcCode'] as string | null) ?? null,
        sentQty: num(r['sentQty']),
      }),
    );

    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      WHERE op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
    `)) as unknown as Array<{ total: number }>;

    const jcOptions = (await tx.execute(sql`
      SELECT DISTINCT jc.id AS "jcId", jc.code AS "jcCode"
      FROM public.job_cards jc
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
      ORDER BY jc.code
    `)) as unknown as Array<{ jcId: string; jcCode: string }>;

    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
      jcOptions,
    };
  });
}

export async function changeJcOpMachine(
  jcOpId: string,
  input: ChangeJcOpMachineInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  // Re-routing a saved JC operation to another machine is an edit on the Job
  // Card (jc_create). L3 Editor and up in Production may; L2 create-only cannot.
  await requireFormAccess(user, 'jc_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    // Verify the op exists and that a machine change is still meaningful.
    //
    // Since migration 0095 every op_log row permanently carries the machine that
    // produced its qty (`op_log.machine_id` / `machine_code_text`), so changing
    // `jc_ops.machine_id` no longer re-attributes past production — it only says
    // "which machine runs the REMAINING qty". Mid-flight swaps (50 pcs on CNC-01,
    // balance on CNC-02) are therefore allowed and BOTH records are kept.
    const opRows = (await tx.execute(sql`
      SELECT op.id,
             op.op_seq AS "opSeq",
             op.operation,
             jc.code AS "jcCode",
             COALESCE(m.code, op.machine_code_text) AS "oldMachineCode",
             COALESCE(s.computed_status, 'waiting') AS status,
             COALESCE(s.completed_qty, 0) AS done
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = op.machine_id AND m.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE op.id = ${jcOpId}::uuid
        AND op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{
      opSeq: number;
      operation: string;
      jcCode: string;
      oldMachineCode: string | null;
      status: string;
      done: number;
    }>;
    const op = opRows[0];
    if (!op) throw new NotFoundError(`JC operation ${jcOpId} not found`);
    const status = String(op.status);
    if (status === 'complete') {
      // Naming the op, the qty and the machine it stays on answers the three
      // questions the old one-liner left open: which op, how much, and where
      // does the production I can see actually live now.
      throw new ConflictError(
        `Op ${op.opSeq} ${op.operation} on ${op.jcCode} is finished — all ` +
          `${op.done} ${op.done === 1 ? 'pc is' : 'pcs are'} made, so there is nothing left ` +
          `to run on another machine. ` +
          (op.oldMachineCode
            ? `The ${op.done} stay recorded against ${op.oldMachineCode}.`
            : `The finished qty stays recorded against the machine that made it.`),
      );
    }

    // Guard (mirrors ADR-084): an OPEN in-house running session means pieces are
    // being produced on the CURRENT machine right now, and they are only written
    // to op_log — with that machine stamped on them — when the session is
    // stopped. Swapping the machine first would stamp the new machine on work the
    // old one actually did. isOsp=false = the in-house lane (not a vendor lane).
    const runningRows = (await tx.execute(sql`
      SELECT 1 AS one
      FROM public.running_ops
      WHERE jc_op_id = ${jcOpId}::uuid
        AND status = 'running'
        AND is_osp = false
      LIMIT 1
    `)) as unknown as Array<{ one: number }>;
    if (runningRows.length > 0) {
      throw new ConflictError(
        'Stop the running machine session before changing the machine — the pieces already made are recorded against the current machine, then switch.',
      );
    }

    // Verify the target machine exists in this company
    const machineRows = (await tx.execute(sql`
      SELECT code FROM public.machines
      WHERE id = ${input.machineId}::uuid
        AND company_id = ${companyId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ code: string }>;
    if (!machineRows[0]) throw new NotFoundError(`Machine ${input.machineId} not found`);

    await tx.execute(sql`
      UPDATE public.jc_ops
      SET machine_id = ${input.machineId}::uuid,
          machine_code_text = ${machineRows[0].code},
          updated_at = now(),
          updated_by = ${userId}::uuid
      WHERE id = ${jcOpId}::uuid
        AND company_id = ${companyId}::uuid
    `);

    // Audit trail: the swap itself. Past production keeps its own machine on
    // op_log; this line records who moved the remaining qty, and from where.
    // The "stays where" clause is read from the real per-machine split, NOT
    // from the op total — on a second swap the total spans several machines
    // and naming only the outgoing one is a lie (ADR-125).
    const split = await loadMachineSplit(tx, jcOpId);
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'JC Operation',
        detail:
          `Machine changed on ${op.jcCode} op ${num(op.opSeq)} ${op.operation} — ` +
          `${op.oldMachineCode ?? '(none)'} → ${machineRows[0].code}; ` +
          describeMachineSplit(split),
        refId: op.jcCode,
      },
      companyId,
      user,
    );

    return { ok: true };
  });
}
