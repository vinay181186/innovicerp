// Daily Report service.
//
// Per-day production summary grouped by machine. Mirrors legacy
// renderDailyReport (HTML L10823) — filters op_log by date, excludes
// 'start' rows + zero qty, groups by machine, sums qty.

import { sql } from 'drizzle-orm';
import type {
  DailyReportMachineGroup,
  DailyReportQuery,
  DailyReportResponse,
  DailyReportRow,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

export async function getDailyReport(
  input: DailyReportQuery,
  user: AuthContext,
): Promise<DailyReportResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const machineFrag = input.machineId
      ? sql`AND op.machine_id = ${input.machineId}::uuid`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        l.id AS "logId",
        jc.code AS "jcCode",
        COALESCE(i.code, jc.item_code_text) AS "itemCode",
        COALESCE(i.name, jc.item_name_text) AS "itemName",
        op.op_seq AS "opSeq",
        op.operation,
        l.shift::text AS shift,
        l.qty,
        l.operator_name AS operator,
        l.remarks,
        op.machine_id AS "machineId",
        COALESCE(m.code, op.machine_code_text, '—') AS "machineCode",
        m.name AS "machineName"
      FROM public.op_log l
      JOIN public.jc_ops op ON op.id = l.jc_op_id AND op.deleted_at IS NULL
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = op.machine_id AND m.deleted_at IS NULL
      WHERE l.company_id = ${companyId}::uuid
        AND l.log_date = ${input.date}::date
        AND l.log_type <> 'start'
        AND l.qty > 0
        ${machineFrag}
      ORDER BY COALESCE(m.code, op.machine_code_text, ''), op.op_seq, l.id
    `);

    const allRows = result as unknown as Array<Record<string, unknown>>;

    // Group by machine
    const byMachine = new Map<string, DailyReportMachineGroup>();
    let totalPieces = 0;
    const jcSet = new Set<string>();

    for (const r of allRows) {
      const machineKey = (r['machineId'] as string | null) ?? `__txt:${String(r['machineCode'])}`;
      const qty = Number(r['qty'] ?? 0);
      totalPieces += qty;
      jcSet.add(String(r['jcCode']));

      const row: DailyReportRow = {
        logId: r['logId'] as string,
        jcCode: String(r['jcCode'] ?? ''),
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        opSeq: Number(r['opSeq'] ?? 0),
        operation: String(r['operation'] ?? ''),
        shift: String(r['shift'] ?? ''),
        qty,
        operator: (r['operator'] as string | null) ?? null,
        remarks: (r['remarks'] as string | null) ?? null,
      };

      let grp = byMachine.get(machineKey);
      if (!grp) {
        grp = {
          machineId: (r['machineId'] as string | null) ?? null,
          machineCode: String(r['machineCode'] ?? '—'),
          machineName: (r['machineName'] as string | null) ?? null,
          totalQty: 0,
          rows: [],
        };
        byMachine.set(machineKey, grp);
      }
      grp.totalQty += qty;
      grp.rows.push(row);
    }

    return {
      date: input.date,
      machineId: input.machineId ?? null,
      summary: {
        totalPieces,
        logEntries: allRows.length,
        machinesActive: byMachine.size,
        jcsActive: jcSet.size,
      },
      groups: Array.from(byMachine.values()),
    };
  });
}
