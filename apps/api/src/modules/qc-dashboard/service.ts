// QC engineer dashboard service (T-040g).
//
// One aggregate read endpoint backed by 4 parallel queries scoped to the
// caller's company via withUserContext (RLS enforces it at the DB layer;
// service-level scope is defensive).
//
// Role gate: admin, manager, viewer, qc — anyone else gets 403. The QC
// dashboard is intentionally narrower than /dashboard/kpis; an operator
// or procurement user looking at QC engineer performance is not a use
// case we want to surface here.
//
// "Today" + "month" derived in JS (UTC date) and passed as bind params.
// Postgres comparisons use date columns so timezone slippage is bounded
// to the report grain.

import type { UserRole } from '@innovic/shared';
import type {
  QcDashboardQuery,
  QcDashboardResponse,
  QcEngineerPerfRow,
  QcPendingRow,
  QcRejectionReasonRow,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

const ALLOWED_ROLES: readonly UserRole[] = ['admin', 'manager', 'viewer', 'qc'];

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function requireQcVisibility(user: AuthContext): void {
  if (!ALLOWED_ROLES.includes(user.role)) {
    throw new AuthorizationError('QC dashboard is restricted to admin / manager / viewer / qc');
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthIso(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthStartIso(month: string): string {
  return `${month}-01`;
}

function monthEndExclusiveIso(month: string): string {
  // First day of the following month — used as `< monthEnd` upper bound.
  // Schema regex guarantees YYYY-MM shape so the parts are always defined.
  const parts = month.split('-');
  const y = Number.parseInt(parts[0]!, 10);
  const m = Number.parseInt(parts[1]!, 10);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny.toString().padStart(4, '0')}-${nm.toString().padStart(2, '0')}-01`;
}

function pctOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

interface SummaryRow {
  pending_calls: number;
  overdue_calls: number;
  inspected_today: number;
  accepted_today: number;
  rejected_today: number;
  month_calls: number;
  month_accepted: number;
  month_rejected: number;
}

interface PendingDbRow {
  jc_op_id: string;
  jc_id: string;
  jc_code: string;
  op_seq: number;
  operation: string;
  item_code: string | null;
  so_code: string | null;
  qc_pending: number;
  qc_call_date: string | null;
  wait_days: number | null;
}

interface EngineerPerfDbRow {
  engineer: string;
  calls: number;
  accepted_qty: number;
  rejected_qty: number;
  avg_response_days: string | null;
}

interface RejectionReasonDbRow {
  reason_category: string;
  count: number;
}

export async function getQcDashboard(
  user: AuthContext,
  query: QcDashboardQuery,
): Promise<QcDashboardResponse> {
  requireQcVisibility(user);
  const companyId = requireCompany(user);
  const month = query.month ?? currentMonthIso();
  const engineer = query.engineer ?? null;
  const today = todayIso();
  const monthStart = monthStartIso(month);
  const monthEnd = monthEndExclusiveIso(month);

  return withUserContext(user, async (tx) => {
    const [summaryRes, pendingRes, engineerPerfRes, rejectionReasonsRes, engineersRes] =
      await Promise.all([
        // 1. Summary aggregates — single row with all the tile counters.
        //
        // Pending + overdue come from v_jc_op_status (qc_pending > 0) joined
        // back to jc_ops for qc_call_date. Today/month aggregates come from
        // op_log filtered to log_type='qc'. Engineer filter narrows the
        // op_log slice but NOT the pending/overdue counts (those are a
        // backlog independent of who is on duty today).
        tx.execute(sql`
          WITH pending AS (
            SELECT s.jc_op_id, o.qc_call_date
            FROM v_jc_op_status s
            JOIN jc_ops o ON o.id = s.jc_op_id
            WHERE s.company_id = ${companyId}::uuid
              AND s.qc_pending > 0
          ),
          today_logs AS (
            SELECT qty, reject_qty
            FROM op_log
            WHERE company_id = ${companyId}::uuid
              AND log_type = 'qc'
              AND log_date = ${today}
              AND (${engineer}::text IS NULL OR operator_name = ${engineer}::text)
          ),
          month_logs AS (
            SELECT qty, reject_qty
            FROM op_log
            WHERE company_id = ${companyId}::uuid
              AND log_type = 'qc'
              AND log_date >= ${monthStart}
              AND log_date < ${monthEnd}
              AND (${engineer}::text IS NULL OR operator_name = ${engineer}::text)
          )
          SELECT
            (SELECT COUNT(*) FROM pending)::int AS pending_calls,
            (SELECT COUNT(*) FROM pending
              WHERE qc_call_date IS NOT NULL
                AND (CURRENT_DATE - qc_call_date) > 1)::int AS overdue_calls,
            (SELECT COUNT(*) FROM today_logs)::int AS inspected_today,
            COALESCE((SELECT SUM(qty) FROM today_logs), 0)::int AS accepted_today,
            COALESCE((SELECT SUM(reject_qty) FROM today_logs), 0)::int AS rejected_today,
            (SELECT COUNT(*) FROM month_logs)::int AS month_calls,
            COALESCE((SELECT SUM(qty) FROM month_logs), 0)::int AS month_accepted,
            COALESCE((SELECT SUM(reject_qty) FROM month_logs), 0)::int AS month_rejected
        `),

        // 2. Pending list — oldest qc_call_date first, with item + SO link.
        // Item code via items.code; SO code via the source_so_line_id chain.
        // soCode null when the JC isn't sourced from an SO (jw-sourced or
        // standalone). Item code never null in practice since job_cards.item_id
        // is NOT NULL, but defensive COALESCE for legacy edge cases.
        //
        // wait_days uses CURRENT_DATE - qc_call_date (date arithmetic returns
        // an integer day count in Postgres); null when qc_call_date is null.
        tx.execute(sql`
          SELECT
            s.jc_op_id,
            j.id AS jc_id,
            j.code AS jc_code,
            o.op_seq,
            o.operation,
            i.code AS item_code,
            so.code AS so_code,
            s.qc_pending::int AS qc_pending,
            o.qc_call_date,
            CASE
              WHEN o.qc_call_date IS NULL THEN NULL
              ELSE (CURRENT_DATE - o.qc_call_date)
            END AS wait_days
          FROM v_jc_op_status s
          JOIN jc_ops o ON o.id = s.jc_op_id
          JOIN job_cards j ON j.id = o.job_card_id
          JOIN items i ON i.id = j.item_id
          LEFT JOIN sales_order_lines sol ON sol.id = j.source_so_line_id
          LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
          WHERE s.company_id = ${companyId}::uuid
            AND s.qc_pending > 0
          ORDER BY o.qc_call_date NULLS LAST, j.code, o.op_seq
          LIMIT 200
        `),

        // 3. Engineer performance — group monthly qc logs by operator_name,
        // compute calls / accepted / rejected / avg response days (date diff
        // against the op's qc_call_date). Engineer filter applies here too.
        // Operator name nullable on op_log; bucket nulls into '(unknown)' so
        // they're still visible but won't get confused with a real operator.
        tx.execute(sql`
          SELECT
            COALESCE(NULLIF(l.operator_name, ''), '(unknown)') AS engineer,
            COUNT(*)::int AS calls,
            COALESCE(SUM(l.qty), 0)::int AS accepted_qty,
            COALESCE(SUM(l.reject_qty), 0)::int AS rejected_qty,
            CASE
              WHEN COUNT(*) FILTER (WHERE o.qc_call_date IS NOT NULL) > 0
              THEN ROUND(
                AVG(GREATEST(l.log_date - o.qc_call_date, 0))
                  FILTER (WHERE o.qc_call_date IS NOT NULL)
                , 1)::text
              ELSE NULL
            END AS avg_response_days
          FROM op_log l
          JOIN jc_ops o ON o.id = l.jc_op_id
          WHERE l.company_id = ${companyId}::uuid
            AND l.log_type = 'qc'
            AND l.log_date >= ${monthStart}
            AND l.log_date < ${monthEnd}
            AND (${engineer}::text IS NULL OR l.operator_name = ${engineer}::text)
          GROUP BY 1
          ORDER BY calls DESC
        `),

        // 4. Top rejection reasons — from nc_register for the month, grouped
        // by reason_category. Engineer filter intentionally NOT applied —
        // NCs aren't keyed by the inspector, and operator → root cause
        // attribution would mislead.
        tx.execute(sql`
          SELECT
            reason_category::text AS reason_category,
            COUNT(*)::int AS count
          FROM nc_register
          WHERE company_id = ${companyId}::uuid
            AND deleted_at IS NULL
            AND nc_date >= ${monthStart}
            AND nc_date < ${monthEnd}
          GROUP BY 1
          ORDER BY count DESC
          LIMIT 8
        `),

        // 5. Engineer dropdown options — distinct operator names from this
        // month's qc logs. Engineer filter NOT applied (the dropdown needs
        // to show all options, not just the selected one).
        tx.execute(sql`
          SELECT DISTINCT operator_name AS engineer
          FROM op_log
          WHERE company_id = ${companyId}::uuid
            AND log_type = 'qc'
            AND log_date >= ${monthStart}
            AND log_date < ${monthEnd}
            AND operator_name IS NOT NULL
            AND operator_name <> ''
          ORDER BY engineer
        `),
      ]);

    const summaryRow = (summaryRes as unknown as SummaryRow[])[0] ?? {
      pending_calls: 0,
      overdue_calls: 0,
      inspected_today: 0,
      accepted_today: 0,
      rejected_today: 0,
      month_calls: 0,
      month_accepted: 0,
      month_rejected: 0,
    };

    const acceptedToday = Number(summaryRow.accepted_today);
    const rejectedToday = Number(summaryRow.rejected_today);
    const monthAccepted = Number(summaryRow.month_accepted);
    const monthRejected = Number(summaryRow.month_rejected);

    const pending: QcPendingRow[] = (pendingRes as unknown as PendingDbRow[]).map((r) => ({
      jcOpId: r.jc_op_id,
      jcId: r.jc_id,
      jcCode: r.jc_code,
      opSeq: Number(r.op_seq),
      operation: r.operation,
      itemCode: r.item_code,
      soCode: r.so_code,
      qcPending: Number(r.qc_pending),
      qcCallDate: r.qc_call_date,
      waitDays: r.wait_days == null ? null : Number(r.wait_days),
    }));

    const engineerPerf: QcEngineerPerfRow[] = (
      engineerPerfRes as unknown as EngineerPerfDbRow[]
    ).map((r) => {
      const acc = Number(r.accepted_qty);
      const rej = Number(r.rejected_qty);
      return {
        engineer: r.engineer,
        calls: Number(r.calls),
        acceptedQty: acc,
        rejectedQty: rej,
        ratePct: pctOrNull(acc, acc + rej),
        avgResponseDays: r.avg_response_days,
      };
    });

    const reasonRows = rejectionReasonsRes as unknown as RejectionReasonDbRow[];
    const reasonTotal = reasonRows.reduce((s, r) => s + Number(r.count), 0);
    const topRejectionReasons: QcRejectionReasonRow[] = reasonRows.map((r) => ({
      reasonCategory: r.reason_category,
      count: Number(r.count),
      pct: reasonTotal > 0 ? Math.round((Number(r.count) / reasonTotal) * 100) : 0,
    }));

    const engineers = (engineersRes as unknown as Array<{ engineer: string }>).map(
      (r) => r.engineer,
    );

    return {
      generatedAt: new Date().toISOString(),
      month,
      engineer,
      engineers,
      summary: {
        pendingCalls: Number(summaryRow.pending_calls),
        overdueCalls: Number(summaryRow.overdue_calls),
        inspectedToday: Number(summaryRow.inspected_today),
        acceptedToday,
        rejectedToday,
        todayRatePct: pctOrNull(acceptedToday, acceptedToday + rejectedToday),
        monthCalls: Number(summaryRow.month_calls),
        monthAccepted,
        monthRejected,
        monthRatePct: pctOrNull(monthAccepted, monthAccepted + monthRejected),
      },
      pending,
      engineerPerf,
      topRejectionReasons,
    };
  });
}
