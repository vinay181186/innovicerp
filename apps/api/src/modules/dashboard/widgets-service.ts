// Widgets view data — mirror of legacy _dashWidgets render fns (L3495). Each
// data widget's numbers are computed server-side; the web renders the card.
// my_alerts + quick_links are composed client-side (alerts query + registry).

import type { ListWidgetsResponse, WidgetData } from '@innovic/shared';
import { DASHBOARD_WIDGETS } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { type DashAccess, hasDept, loadAccess } from './access';
import { getConfig } from './config-service';
import { getMachineLoading } from '../machine-loading/service';
import { istToday } from './work-list-service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};
type Row = Record<string, string | number | null>;
async function q(tx: DbTransaction, text: string): Promise<Row[]> {
  return (await tx.execute(sql.raw(text))) as unknown as Row[];
}
const num = (v: string | number | null | undefined): number => Number(v ?? 0) || 0;

function shell(key: string): WidgetData {
  const def = DASHBOARD_WIDGETS.find((w) => w.key === key)!;
  return {
    key: def.key,
    label: def.label,
    icon: def.icon,
    color: def.color,
    dept: def.dept,
    navPage: def.navPage,
    emptyText: null,
    stats: [],
    bars: [],
    rows: [],
  };
}

async function computeWidget(
  tx: DbTransaction,
  cid: string,
  userId: string,
  today: string,
  key: string,
  mlBars: WidgetData['bars'],
): Promise<WidgetData> {
  const w = shell(key);
  const d7 = new Date(Date.now() + 7 * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);

  switch (key) {
    case 'open_sos': {
      const r = (await q(tx, `SELECT COUNT(*)::int AS sos, COALESCE(SUM(order_qty),0)::int AS qty,
          COUNT(*) FILTER (WHERE due_min IS NOT NULL AND due_min <= '${d7}')::int AS due7 FROM (
            SELECT so.id, COALESCE(SUM(sol.order_qty),0) AS order_qty, MIN(sol.due_date) AS due_min
            FROM sales_orders so LEFT JOIN sales_order_lines sol ON sol.sales_order_id=so.id AND sol.deleted_at IS NULL
            WHERE so.company_id='${cid}'::uuid AND so.status='open' AND so.deleted_at IS NULL GROUP BY so.id) x`))[0];
      w.stats = [
        { label: 'SOs', value: num(r?.['sos']), tone: 'cyan' },
        { label: 'Total Qty', value: num(r?.['qty']), tone: null },
        { label: 'Due 7 days', value: num(r?.['due7']), tone: num(r?.['due7']) > 0 ? 'red' : 'green' },
      ];
      break;
    }
    case 'jc_status': {
      const r = (await q(tx, `SELECT
          COUNT(*) FILTER (WHERE open_ops > 0)::int AS open_jcs,
          COUNT(*) FILTER (WHERE open_ops = 0)::int AS done_jcs,
          COUNT(*)::int AS total FROM (
            SELECT jc.id, COUNT(*) FILTER (WHERE vs.computed_status <> 'complete')::int AS open_ops
            FROM job_cards jc JOIN v_jc_op_status vs ON vs.job_card_id=jc.id
            WHERE jc.company_id='${cid}'::uuid AND jc.deleted_at IS NULL GROUP BY jc.id) y`))[0];
      w.stats = [
        { label: 'Open', value: num(r?.['open_jcs']), tone: 'amber' },
        { label: 'Complete', value: num(r?.['done_jcs']), tone: 'green' },
        { label: 'Total', value: num(r?.['total']), tone: null },
      ];
      break;
    }
    case 'running_machines': {
      const rows = await q(tx, `SELECT m.code AS machine, jc.code AS jc, o.operation FROM running_ops ro
          JOIN jc_ops o ON o.id=ro.jc_op_id JOIN job_cards jc ON jc.id=o.job_card_id
          LEFT JOIN machines m ON m.id=ro.machine_id
          WHERE ro.company_id='${cid}'::uuid AND ro.status='running' LIMIT 5`);
      w.rows = rows.map((r) => ({ left: String(r['machine'] ?? '—'), mid: String(r['jc'] ?? ''), right: String(r['operation'] ?? '') }));
      w.emptyText = 'No machines running';
      break;
    }
    case 'machine_loading': {
      w.bars = mlBars;
      w.emptyText = 'No machines';
      break;
    }
    case 'qc_pending': {
      const opPend = num((await q(tx, `SELECT COUNT(*)::int AS c FROM v_jc_op_status WHERE company_id='${cid}'::uuid AND qc_pending > 0`))[0]?.['c']);
      const grnPend = num((await q(tx, `SELECT COUNT(DISTINCT g.id)::int AS c FROM goods_receipt_notes g JOIN goods_receipt_note_lines gl ON gl.goods_receipt_note_id=g.id AND gl.qc_status='pending' AND gl.deleted_at IS NULL WHERE g.company_id='${cid}'::uuid AND g.deleted_at IS NULL`))[0]?.['c']);
      w.stats = [
        { label: 'QC Ops Pending', value: opPend, tone: 'amber' },
        { label: 'GRN Pending QC', value: grnPend, tone: 'amber' },
      ];
      break;
    }
    case 'stock_alerts': {
      const zero = num((await q(tx, `SELECT COUNT(*)::int AS c FROM items i
          LEFT JOIN v_item_stock vs ON vs.item_id=i.id AND vs.company_id=i.company_id
          WHERE i.company_id='${cid}'::uuid AND i.deleted_at IS NULL AND COALESCE(vs.on_hand_qty,0) <= 0`))[0]?.['c']);
      w.stats = [{ label: 'Items at zero stock', value: zero, tone: zero > 0 ? 'red' : 'green' }];
      break;
    }
    case 'pr_pending': {
      const r = (await q(tx, `SELECT
          COUNT(*) FILTER (WHERE status='open')::int AS pending,
          COUNT(*) FILTER (WHERE status='approved')::int AS approved,
          COUNT(*) FILTER (WHERE status='po_created')::int AS pocreated
          FROM purchase_requests WHERE company_id='${cid}'::uuid AND deleted_at IS NULL`))[0];
      w.stats = [
        { label: 'Pending', value: num(r?.['pending']), tone: 'amber' },
        { label: 'Approved', value: num(r?.['approved']), tone: 'blue' },
        { label: 'PO Created', value: num(r?.['pocreated']), tone: 'green' },
      ];
      break;
    }
    case 'po_status': {
      const r = (await q(tx, `SELECT COUNT(*) FILTER (WHERE status='open')::int AS open, COUNT(*)::int AS total
          FROM purchase_orders WHERE company_id='${cid}'::uuid AND deleted_at IS NULL`))[0];
      w.stats = [
        { label: 'Open', value: num(r?.['open']), tone: 'amber' },
        { label: 'Total', value: num(r?.['total']), tone: null },
      ];
      break;
    }
    case 'cost_summary': {
      const r = (await q(tx, `SELECT
          COALESCE(SUM(pol.qty*pol.rate) FILTER (WHERE po.po_type <> 'job_work'),0) AS mat,
          COALESCE(SUM(pol.qty*pol.rate) FILTER (WHERE po.po_type = 'job_work'),0) AS osp
          FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id AND po.deleted_at IS NULL
          WHERE pol.company_id='${cid}'::uuid AND pol.deleted_at IS NULL`))[0];
      const mat = Math.round(num(r?.['mat'])), osp = Math.round(num(r?.['osp']));
      w.stats = [
        { label: 'Material', value: `₹${mat}`, tone: 'blue' },
        { label: 'Outsource', value: `₹${osp}`, tone: 'amber' },
        { label: 'Total', value: `₹${mat + osp}`, tone: 'green' },
      ];
      break;
    }
    case 'my_tasks': {
      const r = (await q(tx, `SELECT
          COUNT(*) FILTER (WHERE status='todo')::int AS todo,
          COUNT(*) FILTER (WHERE status='in_progress')::int AS inprog,
          COUNT(*) FILTER (WHERE status<>'completed' AND due_date IS NOT NULL AND due_date < '${today}')::int AS overdue
          FROM tasks WHERE company_id='${cid}'::uuid AND assigned_to='${userId}'::uuid AND deleted_at IS NULL`))[0];
      w.stats = [
        { label: 'To Do', value: num(r?.['todo']), tone: 'amber' },
        { label: 'In Progress', value: num(r?.['inprog']), tone: 'cyan' },
        { label: 'Overdue', value: num(r?.['overdue']), tone: 'red' },
      ];
      break;
    }
    case 'so_progress': {
      const rows = await q(tx, `SELECT so.code, COALESCE(SUM(sol.order_qty),0)::int AS order_qty,
          COALESCE(SUM(rdy.ready),0)::int AS done FROM sales_orders so
          JOIN sales_order_lines sol ON sol.sales_order_id=so.id AND sol.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(x.eff),0) AS ready FROM (
              SELECT DISTINCT ON (jc.id) CASE
                WHEN vs.op_type='qc' OR vs.qc_required THEN vs.qc_accepted_qty
                WHEN vs.op_type='outsource' AND vs.computed_status='complete' THEN vs.input_avail
                WHEN vs.op_type='outsource' THEN 0 ELSE vs.completed_qty END AS eff
              FROM job_cards jc JOIN v_jc_op_status vs ON vs.job_card_id=jc.id
              WHERE jc.source_so_line_id=sol.id AND jc.deleted_at IS NULL
              ORDER BY jc.id, vs.op_seq DESC) x) rdy ON TRUE
          WHERE so.company_id='${cid}'::uuid AND so.status='open' AND so.deleted_at IS NULL
          GROUP BY so.id, so.code`);
      const list = rows
        .map((r) => ({ code: String(r['code'] ?? ''), oq: num(r['order_qty']), done: num(r['done']) }))
        .map((s) => ({ ...s, pct: s.oq > 0 ? Math.min(100, Math.round((s.done / s.oq) * 100)) : 0 }))
        .sort((x, y) => x.pct - y.pct)
        .slice(0, 5);
      w.bars = list.map((s) => ({ label: s.code, pct: s.pct, tone: s.pct >= 100 ? 'green' : 'cyan' }));
      w.emptyText = 'No open SOs';
      break;
    }
    case 'grn_pending': {
      const rows = await q(tx, `SELECT DISTINCT g.code, COALESCE(SUM(gl.received_qty),0)::int AS qty FROM goods_receipt_notes g
          JOIN goods_receipt_note_lines gl ON gl.goods_receipt_note_id=g.id AND gl.qc_status='pending' AND gl.deleted_at IS NULL
          WHERE g.company_id='${cid}'::uuid AND g.deleted_at IS NULL GROUP BY g.id, g.code LIMIT 5`);
      w.rows = rows.map((r) => ({ left: String(r['code'] ?? ''), mid: '', right: String(num(r['qty'])) }));
      w.emptyText = 'All clear';
      break;
    }
    case 'daily_quick': {
      const r = (await q(tx, `SELECT COUNT(dr.id)::int AS reports, COALESCE(SUM(drl_cnt.cnt),0)::int AS tasks, COALESCE(SUM(drl_cnt.hrs),0)::numeric AS hours
          FROM daily_reports dr
          LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt, COALESCE(SUM(hours),0)::numeric AS hrs FROM daily_report_lines WHERE daily_report_id=dr.id AND deleted_at IS NULL) drl_cnt ON TRUE
          WHERE dr.company_id='${cid}'::uuid AND dr.user_id='${userId}'::uuid AND dr.report_date='${today}' AND dr.deleted_at IS NULL`))[0];
      const filed = num(r?.['reports']) > 0;
      w.stats = filed
        ? [{ label: 'Filed today', value: `${num(r?.['tasks'])} tasks · ${num(r?.['hours']).toFixed(1)}h`, tone: 'green' }]
        : [{ label: 'Today', value: 'No report filed', tone: 'amber' }];
      break;
    }
    default:
      break;
  }
  return w;
}

export async function getWidgets(user: AuthContext): Promise<ListWidgetsResponse> {
  const companyId = requireCompany(user);
  const a: DashAccess = await loadAccess(user);
  const cfg = await getConfig(user);
  const today = istToday();

  // Ordered, selected, access-permitted widget keys. null config = all in
  // registry order. my_alerts + quick_links are returned as shells (web
  // composes them) so the chosen order is preserved.
  const order = cfg.widgets && cfg.widgets.length ? cfg.widgets : DASHBOARD_WIDGETS.map((w) => w.key);
  const dataKeys = new Set([
    'open_sos', 'jc_status', 'running_machines', 'machine_loading', 'qc_pending',
    'stock_alerts', 'pr_pending', 'po_status', 'cost_summary', 'my_tasks',
    'so_progress', 'grn_pending', 'daily_quick',
  ]);

  // Machine-loading widget reuses the existing per-machine utilization service.
  let mlBars: WidgetData['bars'] = [];
  if (hasDept(a, 'production')) {
    const ml = await getMachineLoading(user);
    mlBars = ml.machines.slice(0, 6).map((m) => ({
      label: m.machineCode,
      pct: Math.min(100, Math.round((m.loadPct ?? 0) * 100)),
      tone: (m.loadPct ?? 0) > 0.8 ? 'red' : (m.loadPct ?? 0) > 0.5 ? 'amber' : 'green',
    }));
  }

  return withUserContext(user, async (tx) => {
    const widgets: WidgetData[] = [];
    for (const key of order) {
      const def = DASHBOARD_WIDGETS.find((w) => w.key === key);
      if (!def) continue;
      if (!hasDept(a, def.dept)) continue;
      if (dataKeys.has(key)) {
        widgets.push(await computeWidget(tx, companyId, user.id, today, key, mlBars));
      } else {
        widgets.push(shell(key)); // my_alerts / quick_links — web composes
      }
    }
    return { widgets };
  });
}
