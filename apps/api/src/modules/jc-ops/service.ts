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
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

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
          OR COALESCE(i.code, jc.item_code_text) ILIKE ${term}
        )`
      : sql``;

    // cycle_time_min stored in minutes → convert to hours for legacy parity.
    // Pending hrs = (available pcs) * (cycle minutes / 60).
    const result = await tx.execute(sql`
      SELECT
        op.id AS "jcOpId",
        jc.id AS "jcId",
        jc.code AS "jcCode",
        COALESCE(i.code, jc.item_code_text) AS "jcItemCode",
        COALESCE(i.name, jc.item_name_text) AS "jcItemName",
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
        po.code AS "outsourcePoCode",
        op.outsource_sent_qty AS "sentQty"
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = op.machine_id AND m.deleted_at IS NULL
      LEFT JOIN public.vendors ven ON ven.id = op.outsource_vendor_id AND ven.deleted_at IS NULL
      LEFT JOIN public.purchase_requests pr ON pr.id = op.outsource_pr_id AND pr.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol ON pol.id = op.outsource_po_line_id AND pol.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
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
        jcItemName: (r['jcItemName'] as string | null) ?? null,
        jcOrderQty: num(r['jcOrderQty']),
        opSeq: num(r['opSeq']),
        operation: String(r['operation'] ?? ''),
        machineId: (r['machineId'] as string | null) ?? null,
        machineCode: (r['machineCode'] as string | null) ?? null,
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
        outsourcePoCode: (r['outsourcePoCode'] as string | null) ?? null,
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
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    // Verify op exists + still editable (status must be Waiting / Available — i.e. no logged work yet)
    const opRows = (await tx.execute(sql`
      SELECT op.id, op.company_id, COALESCE(s.computed_status, 'waiting') AS status,
             COALESCE(s.completed_qty, 0) AS done
      FROM public.jc_ops op
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE op.id = ${jcOpId}::uuid
        AND op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ status: string; done: number }>;
    const op = opRows[0];
    if (!op) throw new NotFoundError(`JC operation ${jcOpId} not found`);
    const status = String(op.status);
    if (status !== 'waiting' && status !== 'available') {
      throw new ConflictError(
        `Cannot change machine: op status is "${status}" (only waiting/available allowed).`,
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

    return { ok: true };
  });
}
