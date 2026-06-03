// Work List (My Work) engine — 9 dept-gated rules, sorted by severity then age.
// Mirror of legacy _buildWorkList (L3196) + wlRule_* (L2959-3193). Pure-SQL
// aggregation; each rule guarded so one failure can't sink the panel.

import type { WorkListItem, WorkListSeverity } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { type DashAccess, hasDept, loadAccess } from './access';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysAgo(dateStr: string | null, today: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr).getTime();
  const t = new Date(today).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.max(0, Math.round((t - d) / 86400000));
}
function daysTo(dateStr: string | null, today: string): number {
  if (!dateStr) return 9999;
  const d = new Date(dateStr).getTime();
  const t = new Date(today).getTime();
  if (Number.isNaN(d)) return 9999;
  return Math.round((d - t) / 86400000);
}

type Row = Record<string, string | number | null>;
async function q(tx: DbTransaction, text: string): Promise<Row[]> {
  return (await tx.execute(sql.raw(text))) as unknown as Row[];
}

// ── Rule 1: PO awaiting approval (draft) ──
async function rulePoApproval(tx: DbTransaction, cid: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT code, po_date, vendor_code_text FROM purchase_orders
     WHERE company_id='${cid}'::uuid AND status='draft' AND deleted_at IS NULL`,
  );
  return rows.map((r) => {
    const age = daysAgo(r['po_date'] as string, today);
    const sev: WorkListSeverity = age > 3 ? 'critical' : age > 1 ? 'warn' : 'info';
    return {
      key: `po_approve:${r['code']}`,
      dept: 'purchase',
      severity: sev,
      icon: '🟡',
      title: `PO ${r['code']} — awaiting approval`,
      detail: `${r['vendor_code_text'] ?? '—'}`,
      age,
      actionLabel: 'View',
      navPage: '/purchase-orders',
    };
  });
}

// ── Rule 2: PR approved, no PO ──
async function rulePrConversion(tx: DbTransaction, cid: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT code, pr_date, item_code_text, item_name, qty FROM purchase_requests
     WHERE company_id='${cid}'::uuid AND status='approved' AND deleted_at IS NULL`,
  );
  return rows.map((r) => {
    const age = daysAgo(r['pr_date'] as string, today);
    const sev: WorkListSeverity = age > 3 ? 'critical' : age > 1 ? 'warn' : 'info';
    return {
      key: `pr_convert:${r['code']}`,
      dept: 'purchase',
      severity: sev,
      icon: '📝',
      title: `PR ${r['code']} — approved, needs PO creation`,
      detail: `${r['item_code_text'] ?? r['item_name'] ?? ''} · ${Number(r['qty']) || 0} · approved ${r['pr_date'] ?? ''}`,
      age,
      actionLabel: 'Create PO',
      navPage: '/purchase-requests',
    };
  });
}

// ── Rule 3: Pending incoming QC (GRN lines pending) ──
async function rulePendingQC(tx: DbTransaction, cid: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT g.code, g.grn_date, g.vendor_code_text,
            COALESCE(SUM(gl.received_qty),0)::int AS qty
     FROM goods_receipt_notes g
     JOIN goods_receipt_note_lines gl ON gl.goods_receipt_note_id = g.id AND gl.deleted_at IS NULL AND gl.qc_status='pending'
     WHERE g.company_id='${cid}'::uuid AND g.deleted_at IS NULL
     GROUP BY g.id, g.code, g.grn_date, g.vendor_code_text`,
  );
  return rows.map((r) => {
    const age = daysAgo(r['grn_date'] as string, today);
    const sev: WorkListSeverity = age > 2 ? 'critical' : 'warn';
    return {
      key: `qc_incoming:${r['code']}`,
      dept: 'qc',
      severity: sev,
      icon: '🔬',
      title: `GRN ${r['code']} — pending inspection`,
      detail: `${r['vendor_code_text'] ?? ''} · Qty ${Number(r['qty']) || 0}`,
      age,
      actionLabel: 'Inspect',
      navPage: '/incoming-qc',
    };
  });
}

// ── Rule 4: Equipment SO with BOM pending (no BOM linked) ──
async function ruleBomPending(tx: DbTransaction, cid: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT so.code, so.customer_name, so.so_date,
            MIN(sol.due_date) AS due_date, COALESCE(SUM(sol.order_qty),0)::int AS qty
     FROM sales_orders so
     LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id AND sol.deleted_at IS NULL
     WHERE so.company_id='${cid}'::uuid AND so.type='equipment'
       AND so.status NOT IN ('closed','cancelled') AND so.deleted_at IS NULL
       AND (so.bom_master_id IS NULL OR so.bom_status = 'BOM Pending')
     GROUP BY so.id, so.code, so.customer_name, so.so_date`,
  );
  return rows.map((r) => {
    const dToDue = daysTo(r['due_date'] as string, today);
    const sev: WorkListSeverity = dToDue < 0 ? 'critical' : dToDue <= 7 ? 'warn' : 'info';
    const age = daysAgo(r['so_date'] as string, today);
    return {
      key: `bom_pending:${r['code']}`,
      dept: 'design',
      severity: sev,
      icon: '📋',
      title: `SO ${r['code']} — BOM needed`,
      detail: `${r['customer_name'] ?? ''} · Qty ${Number(r['qty']) || 0} · Due ${r['due_date'] ?? '—'}${dToDue < 0 ? ' (OVERDUE)' : dToDue <= 7 && dToDue >= 0 ? ` (in ${dToDue}d)` : ''}`,
      age,
      actionLabel: 'Create BOM',
      navPage: '/bom-master',
    };
  });
}

// ── Rule 5: My assigned tasks ──
async function ruleMyTasks(tx: DbTransaction, cid: string, userId: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT code, title, description, due_date, viewed_at, assigned_by
     FROM tasks WHERE company_id='${cid}'::uuid AND assigned_to='${userId}'::uuid
       AND status NOT IN ('completed','cancelled') AND deleted_at IS NULL`,
  );
  return rows.map((r) => {
    const dToDue = daysTo(r['due_date'] as string, today);
    const sev: WorkListSeverity = dToDue < 0 ? 'critical' : dToDue === 0 ? 'warn' : 'info';
    const unread = !r['viewed_at'];
    return {
      key: `task:${r['code']}`,
      dept: 'tasks',
      severity: sev,
      icon: '✓',
      title: `${unread ? '🔴 ' : ''}${r['title'] ?? 'Task'} — assigned to you`,
      detail: `${String(r['description'] ?? '').slice(0, 70)} · Due ${r['due_date'] ?? '—'}${dToDue < 0 ? ' (OVERDUE)' : dToDue === 0 ? ' (today)' : ''}`,
      age: daysAgo(null, today),
      actionLabel: 'Open',
      navPage: '/task-board',
    };
  });
}

// ── Rule 6: My CAPAs ──
async function ruleMyCapas(tx: DbTransaction, cid: string, myName: string, today: string): Promise<WorkListItem[]> {
  if (!myName) return [];
  const safe = myName.replace(/'/g, "''");
  const rows = await q(
    tx,
    `SELECT code, problem, target_date, root_cause, corrective_action, verification
     FROM capa_records
     WHERE company_id='${cid}'::uuid AND deleted_at IS NULL
       AND lower(status) NOT IN ('closed','verified')
       AND lower(coalesce(responsible,'')) = lower('${safe}')`,
  );
  return rows.map((r) => {
    const dTo = daysTo(r['target_date'] as string, today);
    const sev: WorkListSeverity = dTo < 0 ? 'critical' : dTo <= 3 ? 'warn' : 'info';
    const nextStep = !r['root_cause']
      ? 'root cause pending'
      : !r['corrective_action']
        ? 'corrective action pending'
        : !r['verification']
          ? 'verification pending'
          : 'preventive action pending';
    return {
      key: `capa:${r['code']}`,
      dept: 'qc',
      severity: sev,
      icon: '🛡',
      title: `CAPA ${r['code']} — ${nextStep}`,
      detail: `${String(r['problem'] ?? '').slice(0, 60)} · Target ${r['target_date'] ?? '—'}${dTo < 0 ? ' (OVERDUE)' : ''}`,
      age: 0,
      actionLabel: 'Continue',
      navPage: '/capa',
    };
  });
}

// ── Rule 7: Overdue Job Cards (due<today, not fully complete) ──
async function ruleOverdueJCs(tx: DbTransaction, cid: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT jc.code, jc.due_date,
        COUNT(*) FILTER (WHERE vs.computed_status <> 'complete')::int AS open_ops,
        COUNT(*)::int AS total_ops
     FROM job_cards jc
     JOIN v_jc_op_status vs ON vs.job_card_id = jc.id
     WHERE jc.company_id='${cid}'::uuid AND jc.deleted_at IS NULL
       AND jc.due_date IS NOT NULL AND jc.due_date < '${today}'
     GROUP BY jc.id, jc.code, jc.due_date
     HAVING COUNT(*) FILTER (WHERE vs.computed_status <> 'complete') > 0`,
  );
  return rows.map((r) => {
    const late = daysAgo(r['due_date'] as string, today);
    return {
      key: `jc_overdue:${r['code']}`,
      dept: 'production',
      severity: 'critical',
      icon: '⏰',
      title: `JC ${r['code']} — ${late} day${late > 1 ? 's' : ''} overdue`,
      detail: `${r['open_ops']}/${r['total_ops']} ops remaining`,
      age: late,
      actionLabel: 'Open',
      navPage: '/job-cards',
    };
  });
}

// ── Rule 8: Overdue PO delivery ──
async function ruleOverduePO(tx: DbTransaction, cid: string, today: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT code, vendor_code_text, due_date FROM purchase_orders
     WHERE company_id='${cid}'::uuid AND status IN ('open','partial')
       AND due_date IS NOT NULL AND due_date < '${today}' AND deleted_at IS NULL`,
  );
  return rows.map((r) => {
    const late = daysAgo(r['due_date'] as string, today);
    const sev: WorkListSeverity = late > 7 ? 'critical' : 'warn';
    return {
      key: `po_overdue:${r['code']}`,
      dept: 'purchase',
      severity: sev,
      icon: '🚚',
      title: `PO ${r['code']} — delivery ${late} day${late > 1 ? 's' : ''} overdue`,
      detail: `${r['vendor_code_text'] ?? ''}`,
      age: late,
      actionLabel: 'Follow up',
      navPage: '/purchase-orders',
    };
  });
}

// ── Rule 9: Running ops past expected cycle time ──
async function ruleStuckOps(tx: DbTransaction, cid: string): Promise<WorkListItem[]> {
  const rows = await q(
    tx,
    `SELECT jc.code AS jc_code, o.op_seq, o.operation, m.code AS machine,
        GREATEST(vs.available, 0) AS avail, o.cycle_time_min::numeric AS cycle_min,
        EXTRACT(EPOCH FROM (now() - (ro.start_date::timestamp + ro.start_time)))/3600 AS elapsed_hrs
     FROM running_ops ro
     JOIN jc_ops o ON o.id = ro.jc_op_id AND o.deleted_at IS NULL
     JOIN job_cards jc ON jc.id = o.job_card_id
     JOIN v_jc_op_status vs ON vs.jc_op_id = o.id
     LEFT JOIN machines m ON m.id = ro.machine_id
     WHERE ro.company_id='${cid}'::uuid AND ro.status='running'`,
  );
  const out: WorkListItem[] = [];
  for (const r of rows) {
    const avail = Number(r['avail']) || 0;
    const cycleMin = Number(r['cycle_min']) || 0;
    const elapsed = Number(r['elapsed_hrs']) || 0;
    const expected = avail * (cycleMin / 60);
    if (expected <= 0 || elapsed <= 0) continue;
    const ratio = elapsed / expected;
    if (ratio < 1) continue;
    const sev: WorkListSeverity = ratio >= 2 ? 'critical' : 'warn';
    out.push({
      key: `op_stuck:${r['jc_code']}:${r['op_seq']}`,
      dept: 'production',
      severity: sev,
      icon: '⚠',
      title: `${r['jc_code']} Op ${r['op_seq']} — ${ratio >= 2 ? 'severely overrun' : 'running late'}`,
      detail: `${r['operation'] ?? ''} on ${r['machine'] ?? ''} · ${elapsed.toFixed(1)}h elapsed (expected ${expected.toFixed(1)}h)`,
      age: Math.round(elapsed / 24),
      actionLabel: 'Review',
      navPage: '/production-dashboard',
    });
  }
  return out;
}

const SEV_RANK: Record<WorkListSeverity, number> = { critical: 0, warn: 1, info: 2 };

export async function buildWorkListWith(
  tx: DbTransaction,
  user: AuthContext,
  a: DashAccess,
  myName: string,
): Promise<WorkListItem[]> {
  const cid = user.companyId!;
  const today = istToday();
  const all: WorkListItem[] = [];
  const run = async (gate: boolean, fn: () => Promise<WorkListItem[]>): Promise<void> => {
    if (!gate) return;
    try {
      all.push(...(await fn()));
    } catch {
      /* one rule failing must not sink the panel (legacy try/catch) */
    }
  };

  await run(hasDept(a, 'purchase'), () => rulePoApproval(tx, cid, today));
  await run(hasDept(a, 'purchase'), () => rulePrConversion(tx, cid, today));
  await run(hasDept(a, 'qc'), () => rulePendingQC(tx, cid, today));
  await run(hasDept(a, 'design'), () => ruleBomPending(tx, cid, today));
  await run(true, () => ruleMyTasks(tx, cid, user.id, today));
  await run(hasDept(a, 'qc'), () => ruleMyCapas(tx, cid, myName, today));
  await run(hasDept(a, 'production'), () => ruleOverdueJCs(tx, cid, today));
  await run(hasDept(a, 'purchase'), () => ruleOverduePO(tx, cid, today));
  await run(hasDept(a, 'production'), () => ruleStuckOps(tx, cid));

  all.sort((x, y) => {
    const s = SEV_RANK[x.severity] - SEV_RANK[y.severity];
    return s !== 0 ? s : (y.age || 0) - (x.age || 0);
  });
  return all;
}

export async function getWorkList(user: AuthContext): Promise<WorkListItem[]> {
  requireCompany(user);
  const a = await loadAccess(user);
  return withUserContext(user, async (tx) => {
    const me = await tx.select({ name: users.fullName }).from(users).where(sql`id = ${user.id}::uuid`).limit(1);
    return buildWorkListWith(tx, user, a, me[0]?.name ?? '');
  });
}
