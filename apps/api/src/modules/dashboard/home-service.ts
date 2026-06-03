// Home (Dashboard) orchestrator — role-aware payload. Mirror of legacy
// renderHome (L2486) + _homeAdminView (L2560). Computes the layout for the
// caller, the My Work list, and the layout-specific data (admin KPIs / today /
// needs-attention, or operator, or specialist).

import type {
  AdminKpis,
  AttnItem,
  HomeResponse,
  HomeToday,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { type DashAccess, detectPrimaryDept, hasDept, loadAccess } from './access';
import { getConfig } from './config-service';
import { buildOperator, buildSpecialist } from './home-views';
import { buildWorkListWith, istToday } from './work-list-service';
import { DASHBOARD_QUICK_LINKS } from '@innovic/shared';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type Row = Record<string, string | number | null>;
async function q(tx: DbTransaction, text: string): Promise<Row[]> {
  return (await tx.execute(sql.raw(text))) as unknown as Row[];
}
const num = (v: string | number | null | undefined): number => Number(v ?? 0) || 0;
async function scalar(tx: DbTransaction, text: string): Promise<number> {
  return num((await q(tx, text))[0]?.['c']);
}

function greetingPart(): string {
  const istHour = Number(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }),
  );
  if (istHour < 12) return 'morning';
  if (istHour < 17) return 'afternoon';
  return 'evening';
}
function dateLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function resolveLayout(a: DashAccess): { layout: HomeResponse['layout']; primaryDept: string | null } {
  if (a.role === 'operator') return { layout: 'operator', primaryDept: null };
  if (!a.isAdmin && !a.isManager && !a.eff.fullAccess) {
    const dept = detectPrimaryDept(a);
    if (dept) return { layout: 'specialist', primaryDept: dept };
  }
  return { layout: 'admin', primaryDept: null };
}

async function buildAdmin(
  tx: DbTransaction,
  cid: string,
  today: string,
): Promise<{ kpis: AdminKpis; today: HomeToday; needsAttention: AttnItem[] }> {
  const d7 = new Date(Date.now() + 7 * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);

  // Active SOs + overdue/due-this-week via earliest line due date.
  const soAgg = (
    await q(
      tx,
      `SELECT
         COUNT(*)::int AS active,
         COUNT(*) FILTER (WHERE due_min < '${today}')::int AS overdue,
         COUNT(*) FILTER (WHERE due_min >= '${today}' AND due_min <= '${d7}')::int AS due_week
       FROM (
         SELECT so.id, MIN(sol.due_date) AS due_min
         FROM sales_orders so
         LEFT JOIN sales_order_lines sol ON sol.sales_order_id=so.id AND sol.deleted_at IS NULL
         WHERE so.company_id='${cid}'::uuid AND so.status NOT IN ('closed','cancelled') AND so.deleted_at IS NULL
         GROUP BY so.id
       ) x`,
    )
  )[0];

  // Open / overdue JCs (incomplete = has an op not 'complete').
  const jcAgg = (
    await q(
      tx,
      `SELECT
         COUNT(*)::int AS open_jcs,
         COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < '${today}')::int AS overdue_jcs
       FROM (
         SELECT jc.id, jc.due_date
         FROM job_cards jc
         JOIN v_jc_op_status vs ON vs.job_card_id=jc.id
         WHERE jc.company_id='${cid}'::uuid AND jc.deleted_at IS NULL
         GROUP BY jc.id, jc.due_date
         HAVING COUNT(*) FILTER (WHERE vs.computed_status <> 'complete') > 0
       ) y`,
    )
  )[0];

  const machsRunning = await scalar(
    tx,
    `SELECT COUNT(DISTINCT machine_id)::int AS c FROM running_ops WHERE company_id='${cid}'::uuid AND status='running' AND machine_id IS NOT NULL`,
  );
  const machsTotal = await scalar(
    tx,
    `SELECT COUNT(*)::int AS c FROM machines WHERE company_id='${cid}'::uuid AND status <> 'Inactive' AND deleted_at IS NULL`,
  );
  const todayOutputQty = await scalar(
    tx,
    `SELECT COALESCE(SUM(qty),0)::int AS c FROM op_log WHERE company_id='${cid}'::uuid AND log_date='${today}' AND log_type='complete'`,
  );

  const kpis: AdminKpis = {
    activeSOs: num(soAgg?.['active']),
    overdueSOs: num(soAgg?.['overdue']),
    dueThisWeekSOs: num(soAgg?.['due_week']),
    openJCs: num(jcAgg?.['open_jcs']),
    overdueJCs: num(jcAgg?.['overdue_jcs']),
    machsRunning,
    machsTotal,
    todayOutputQty,
  };

  const grnReceived = await scalar(tx, `SELECT COUNT(*)::int AS c FROM goods_receipt_notes WHERE company_id='${cid}'::uuid AND grn_date='${today}' AND deleted_at IS NULL`);
  const dispatches = await scalar(tx, `SELECT COUNT(*)::int AS c FROM customer_dispatches WHERE company_id='${cid}'::uuid AND dispatch_date='${today}' AND status='dispatched' AND deleted_at IS NULL`);
  const opsRunning = await scalar(tx, `SELECT COUNT(*)::int AS c FROM running_ops WHERE company_id='${cid}'::uuid AND status='running'`);
  const opsCompleted = await scalar(tx, `SELECT COUNT(*)::int AS c FROM op_log WHERE company_id='${cid}'::uuid AND log_date='${today}' AND log_type <> 'start'`);
  const todayPanel: HomeToday = { grnReceived, dispatches, opsRunning, opsCompleted };

  const draftPOs = await scalar(tx, `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id='${cid}'::uuid AND status='draft' AND deleted_at IS NULL`);
  const overduePOs = await scalar(tx, `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id='${cid}'::uuid AND status IN ('open','partial') AND due_date < '${today}' AND deleted_at IS NULL`);
  const pendingPRs = await scalar(tx, `SELECT COUNT(*)::int AS c FROM purchase_requests WHERE company_id='${cid}'::uuid AND status='open' AND deleted_at IS NULL`);
  const pendingNCs = await scalar(tx, `SELECT COUNT(*)::int AS c FROM nc_register WHERE company_id='${cid}'::uuid AND status='pending' AND deleted_at IS NULL`);

  const attn: AttnItem[] = [];
  const plural = (n: number) => (n > 1 ? 's' : '');
  if (kpis.overdueSOs > 0) attn.push({ icon: '🔴', label: `${kpis.overdueSOs} SO${plural(kpis.overdueSOs)} past due`, navPage: '/so-overview', severity: 'critical' });
  if (overduePOs > 0) attn.push({ icon: '🔴', label: `${overduePOs} PO${plural(overduePOs)} overdue delivery`, navPage: '/purchase-orders', severity: 'critical' });
  if (kpis.overdueJCs > 0) attn.push({ icon: '🔴', label: `${kpis.overdueJCs} Job Card${plural(kpis.overdueJCs)} overdue`, navPage: '/job-cards', severity: 'critical' });
  if (draftPOs > 0) attn.push({ icon: '🟡', label: `${draftPOs} PO${plural(draftPOs)} pending approval`, navPage: '/purchase-orders', severity: 'warn' });
  if (pendingPRs > 0) attn.push({ icon: '🟡', label: `${pendingPRs} Purchase Request${plural(pendingPRs)} pending`, navPage: '/purchase-requests', severity: 'warn' });
  if (pendingNCs > 0) attn.push({ icon: '🟡', label: `${pendingNCs} NC${plural(pendingNCs)} pending disposition`, navPage: '/nc-register', severity: 'warn' });
  if (kpis.dueThisWeekSOs > 0) attn.push({ icon: '🔵', label: `${kpis.dueThisWeekSOs} SO${plural(kpis.dueThisWeekSOs)} due this week`, navPage: '/so-overview', severity: 'info' });

  return { kpis, today: todayPanel, needsAttention: attn.slice(0, 6) };
}

function visibleQuickLinks(a: DashAccess, selected: string[] | null): string[] {
  return DASHBOARD_QUICK_LINKS.filter((l) => hasDept(a, l.dept))
    .filter((l) => !selected || selected.includes(l.page))
    .map((l) => l.page);
}

export async function getHome(user: AuthContext): Promise<HomeResponse> {
  const companyId = requireCompany(user);
  const a = await loadAccess(user);
  const { layout, primaryDept } = resolveLayout(a);
  const today = istToday();
  const cfg = await getConfig(user);

  return withUserContext(user, async (tx) => {
    const meRows = await tx.select({ name: users.fullName }).from(users).where(sql`id = ${user.id}::uuid`).limit(1);
    const myName = meRows[0]?.name ?? '';

    const workList = await buildWorkListWith(tx, user, a, myName);

    const base: HomeResponse = {
      userName: myName || user.email,
      role: user.role,
      dateLabel: dateLabel(),
      greetingPart: greetingPart(),
      layout,
      primaryDept,
      isAdmin: a.isAdmin,
      workList,
      kpis: null,
      today: null,
      needsAttention: null,
      operator: null,
      specialist: null,
      quickLinks: visibleQuickLinks(a, cfg.quickLinks),
    };

    if (layout === 'operator') {
      base.operator = await buildOperator(tx, companyId, today, myName);
    } else if (layout === 'specialist' && primaryDept) {
      base.specialist = await buildSpecialist(tx, companyId, today, primaryDept);
    } else {
      const admin = await buildAdmin(tx, companyId, today);
      base.kpis = admin.kpis;
      base.today = admin.today;
      base.needsAttention = admin.needsAttention;
    }

    return base;
  });
}
