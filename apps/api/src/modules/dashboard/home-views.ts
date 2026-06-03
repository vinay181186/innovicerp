// Operator + specialist home-view builders. Mirror of legacy
// _homeOperatorView (L2674) + _homeSpecialistView (L2769).

import type {
  HomeOperator,
  HomeSpecialist,
  ReadyOpRow,
  RunningOpRow,
  SpecialistKpi,
  SpecialistPanel,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

type Row = Record<string, string | number | null>;
async function q(tx: DbTransaction, text: string): Promise<Row[]> {
  return (await tx.execute(sql.raw(text))) as unknown as Row[];
}
const num = (v: string | number | null | undefined): number => Number(v ?? 0) || 0;

export async function buildOperator(
  tx: DbTransaction,
  cid: string,
  today: string,
  myName: string,
): Promise<HomeOperator> {
  const safeName = myName.replace(/'/g, "''");

  // Currently running (this operator, or unattributed).
  const runningRows = await q(
    tx,
    `SELECT jc.code AS jc_code, o.op_seq, o.operation, m.code AS machine,
        EXTRACT(EPOCH FROM (now() - (ro.start_date::timestamp + ro.start_time)))/60 AS elapsed_min,
        vs.completed_qty, jc.order_qty
     FROM running_ops ro
     JOIN jc_ops o ON o.id = ro.jc_op_id AND o.deleted_at IS NULL
     JOIN job_cards jc ON jc.id = o.job_card_id
     JOIN v_jc_op_status vs ON vs.jc_op_id = o.id
     LEFT JOIN machines m ON m.id = ro.machine_id
     WHERE ro.company_id='${cid}'::uuid AND ro.status='running'
       AND (ro.operator_name = '${safeName}' OR ro.operator_name IS NULL)
     ORDER BY ro.start_date, ro.start_time`,
  );
  const running: RunningOpRow[] = runningRows.map((r) => ({
    jcCode: String(r['jc_code'] ?? ''),
    opSeq: num(r['op_seq']),
    operation: String(r['operation'] ?? ''),
    machine: (r['machine'] as string) ?? null,
    elapsedMin: Math.round(num(r['elapsed_min'])),
    completed: num(r['completed_qty']),
    orderQty: num(r['order_qty']),
  }));

  const allRunning = await q(
    tx,
    `SELECT COUNT(*)::int AS c FROM running_ops WHERE company_id='${cid}'::uuid AND status='running'`,
  );

  // Ready for work — available>0, not running, not outsource/qc.
  const readyRows = await q(
    tx,
    `SELECT jc.code AS jc_code, o.op_seq, o.operation, m.code AS machine,
        sol.item_code_text AS item_code, vs.available, jc.due_date
     FROM v_jc_op_status vs
     JOIN jc_ops o ON o.id = vs.jc_op_id AND o.deleted_at IS NULL
     JOIN job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
     LEFT JOIN machines m ON m.id = o.machine_id
     LEFT JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id
     WHERE vs.company_id='${cid}'::uuid AND vs.available > 0
       AND vs.computed_status IN ('available','in_progress')
       AND vs.op_type NOT IN ('outsource','qc')
     ORDER BY COALESCE(jc.due_date,'9999-12-31') ASC, vs.available DESC
     LIMIT 15`,
  );
  const ready: ReadyOpRow[] = readyRows.map((r) => ({
    jcCode: String(r['jc_code'] ?? ''),
    opSeq: num(r['op_seq']),
    operation: String(r['operation'] ?? ''),
    machine: (r['machine'] as string) ?? null,
    itemCode: (r['item_code'] as string) ?? null,
    available: num(r['available']),
    dueDate: (r['due_date'] as string) ?? null,
    isOverdue: !!r['due_date'] && String(r['due_date']) < today,
  }));

  // My output today.
  const outRows = await q(
    tx,
    `SELECT COALESCE(SUM(qty),0)::int AS qty, COUNT(*)::int AS entries
     FROM op_log
     WHERE company_id='${cid}'::uuid AND log_date='${today}' AND log_type='complete'
       AND (operator_name = '${safeName}' OR operator_name IS NULL)`,
  );

  return {
    myOutputQty: num(outRows[0]?.['qty']),
    myEntries: num(outRows[0]?.['entries']),
    readyCount: ready.length,
    allRunningCount: num(allRunning[0]?.['c']),
    running,
    ready,
  };
}

async function count(tx: DbTransaction, text: string): Promise<number> {
  const rows = await q(tx, text);
  return num(rows[0]?.['c']);
}

export async function buildSpecialist(
  tx: DbTransaction,
  cid: string,
  today: string,
  dept: string,
): Promise<HomeSpecialist> {
  const kpis: SpecialistKpi[] = [];
  const panels: SpecialistPanel[] = [];

  if (dept === 'qc') {
    const pendingQC = await count(
      tx,
      `SELECT COUNT(DISTINCT g.id)::int AS c FROM goods_receipt_notes g
       JOIN goods_receipt_note_lines gl ON gl.goods_receipt_note_id=g.id AND gl.deleted_at IS NULL AND gl.qc_status='pending'
       WHERE g.company_id='${cid}'::uuid AND g.deleted_at IS NULL`,
    );
    const openNCs = await count(
      tx,
      `SELECT COUNT(*)::int AS c FROM nc_register WHERE company_id='${cid}'::uuid AND status='pending' AND deleted_at IS NULL`,
    );
    const activeCAPAs = await count(
      tx,
      `SELECT COUNT(*)::int AS c FROM capa_records WHERE company_id='${cid}'::uuid AND lower(status) NOT IN ('closed','verified') AND deleted_at IS NULL`,
    );
    kpis.push(
      { label: 'Pending Incoming QC', value: pendingQC, sub: 'GRNs awaiting inspection', color: 'var(--dept-qc)', navPage: '/incoming-qc' },
      { label: 'Open NCs', value: openNCs, sub: 'Need disposition', color: 'var(--sig-critical)', navPage: '/nc-register' },
      { label: 'Active CAPAs', value: activeCAPAs, sub: 'Corrective & Preventive', color: 'var(--sig-warn)', navPage: '/capa' },
    );
    const grnRows = await q(
      tx,
      `SELECT DISTINCT g.code, g.grn_date, g.vendor_code_text,
          COALESCE(SUM(gl.received_qty),0)::int AS qty
       FROM goods_receipt_notes g
       JOIN goods_receipt_note_lines gl ON gl.goods_receipt_note_id=g.id AND gl.deleted_at IS NULL AND gl.qc_status='pending'
       WHERE g.company_id='${cid}'::uuid AND g.deleted_at IS NULL
       GROUP BY g.id, g.code, g.grn_date, g.vendor_code_text
       ORDER BY g.grn_date DESC LIMIT 10`,
    );
    panels.push({
      title: 'Pending Incoming QC',
      titleColor: null,
      headers: ['GRN', 'Date', 'Vendor', 'Qty'],
      rows: grnRows.map((r) => ({ cells: [String(r['code'] ?? ''), String(r['grn_date'] ?? ''), String(r['vendor_code_text'] ?? ''), String(num(r['qty']))], navPage: '/incoming-qc' })),
      emptyText: '✅ No pending inspections.',
    });
  } else if (dept === 'purchase') {
    const pendingPRs = await count(tx, `SELECT COUNT(*)::int AS c FROM purchase_requests WHERE company_id='${cid}'::uuid AND status='open' AND deleted_at IS NULL`);
    const draftPOs = await count(tx, `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id='${cid}'::uuid AND status='draft' AND deleted_at IS NULL`);
    const overduePOs = await count(tx, `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id='${cid}'::uuid AND status IN ('open','partial') AND due_date < '${today}' AND deleted_at IS NULL`);
    const openPOs = await count(tx, `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id='${cid}'::uuid AND status IN ('open','partial') AND deleted_at IS NULL`);
    kpis.push(
      { label: 'Pending PRs', value: pendingPRs, sub: 'Awaiting approval', color: 'var(--sig-warn)', navPage: '/purchase-requests' },
      { label: 'Draft POs', value: draftPOs, sub: 'Awaiting approval', color: 'var(--sig-info)', navPage: '/purchase-orders' },
      { label: 'Overdue Deliveries', value: overduePOs, sub: overduePOs > 0 ? 'Follow up vendors' : 'All on time', color: 'var(--sig-critical)', navPage: '/purchase-orders' },
      { label: 'Open POs', value: openPOs, sub: 'In progress', color: 'var(--dept-purchase)', navPage: '/purchase-orders' },
    );
    const prRows = await q(tx, `SELECT code, pr_date, item_code_text, qty FROM purchase_requests WHERE company_id='${cid}'::uuid AND status='open' AND deleted_at IS NULL ORDER BY pr_date DESC LIMIT 8`);
    panels.push({
      title: 'Pending PRs',
      titleColor: null,
      headers: ['PR', 'Date', 'Item', 'Qty'],
      rows: prRows.map((r) => ({ cells: [String(r['code'] ?? ''), String(r['pr_date'] ?? ''), String(r['item_code_text'] ?? ''), String(num(r['qty']))], navPage: '/purchase-requests' })),
      emptyText: '✅ None',
    });
    const poRows = await q(tx, `SELECT code, vendor_code_text, due_date FROM purchase_orders WHERE company_id='${cid}'::uuid AND status IN ('open','partial') AND due_date < '${today}' AND deleted_at IS NULL ORDER BY due_date ASC LIMIT 8`);
    panels.push({
      title: 'Overdue POs',
      titleColor: 'var(--sig-critical)',
      headers: ['PO', 'Vendor', 'Req Date'],
      rows: poRows.map((r) => ({ cells: [String(r['code'] ?? ''), String(r['vendor_code_text'] ?? ''), String(r['due_date'] ?? '')], navPage: '/purchase-orders' })),
      emptyText: '✅ All on time',
    });
  } else {
    // design (and fallback dept)
    const activeProjects = await count(tx, `SELECT COUNT(*)::int AS c FROM design_projects WHERE company_id='${cid}'::uuid AND lower(status) NOT IN ('completed','closed') AND deleted_at IS NULL`);
    const openIssues = await count(tx, `SELECT COUNT(*)::int AS c FROM design_issues WHERE company_id='${cid}'::uuid AND lower(status) NOT IN ('closed','resolved') AND deleted_at IS NULL`);
    const bomsPending = await count(tx, `SELECT COUNT(*)::int AS c FROM sales_orders WHERE company_id='${cid}'::uuid AND type='equipment' AND status NOT IN ('closed','cancelled') AND (bom_master_id IS NULL OR bom_status='BOM Pending') AND deleted_at IS NULL`);
    kpis.push(
      { label: 'Active Projects', value: activeProjects, sub: 'In progress', color: 'var(--dept-design)', navPage: '/design-projects' },
      { label: 'Open Issues', value: openIssues, sub: 'Need resolution', color: 'var(--sig-warn)', navPage: '/design-issues' },
      { label: 'BOMs Pending', value: bomsPending, sub: 'Equipment SOs awaiting BOM', color: 'var(--sig-critical)', navPage: '/bom-master' },
    );
    const soRows = await q(tx, `SELECT so.code, so.so_date, so.customer_name, MIN(sol.due_date) AS due_date FROM sales_orders so LEFT JOIN sales_order_lines sol ON sol.sales_order_id=so.id AND sol.deleted_at IS NULL WHERE so.company_id='${cid}'::uuid AND so.type='equipment' AND so.status NOT IN ('closed','cancelled') AND (so.bom_master_id IS NULL OR so.bom_status='BOM Pending') AND so.deleted_at IS NULL GROUP BY so.id, so.code, so.so_date, so.customer_name ORDER BY so.so_date DESC LIMIT 10`);
    panels.push({
      title: 'Equipment SOs Awaiting BOM',
      titleColor: null,
      headers: ['SO', 'Date', 'Customer', 'Due'],
      rows: soRows.map((r) => ({ cells: [String(r['code'] ?? ''), String(r['so_date'] ?? ''), String(r['customer_name'] ?? ''), String(r['due_date'] ?? '—')], navPage: '/bom-master' })),
      emptyText: '✅ All Equipment SOs have BOMs.',
    });
  }

  return { dept, kpis, panels };
}
