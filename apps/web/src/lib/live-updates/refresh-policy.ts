// CLAUDE.md §22 — how every screen's data stays fresh. Every query-key root the
// app defines is declared here, once, with the reason. refresh-coverage.test.ts
// fails when a root is missing, when a 'live' root is not in LIVE_TABLE_KEYS, or
// when a 'poll' root's module never sets refetchInterval — so a new page cannot
// ship with no refresh plan.
//
//   live    — a table behind it is in LIVE_TABLES; other PCs refresh within ~2 s
//   poll    — its hooks set refetchInterval (LIVE_FALLBACK_POLL_MS = 60 s)
//   on-open — refreshed on open / window focus (30 s staleTime). Only for
//             reference data, reports and look-ups nobody watches change.

export type RefreshMode = 'live' | 'poll' | 'on-open';

export interface RefreshRule {
  mode: RefreshMode;
  why: string;
}

const live = (why: string): RefreshRule => ({ mode: 'live', why });
const poll = (why: string): RefreshRule => ({ mode: 'poll', why });
const onOpen = (why: string): RefreshRule => ({ mode: 'on-open', why });

const MASTER = 'master data — changes rarely; open/focus is enough';
const REPORT = 'report / analysis read on demand';
const LOOKUP = 'look-up for one form, re-read when the form opens';

export const REFRESH_POLICY: Readonly<Record<string, RefreshRule>> = {
  // ── Live (LIVE_TABLE_KEYS) ──
  approvals: live('PR / PO / edit / cancel requests'),
  'cancel-requests': live('cancel_requests'),
  'customer-dispatches': live('customer_dispatches (0227)'),
  dashboard: live('home rows follow every document table'),
  'day-logs': live('daily_reports / day_log_team_mates'),
  'delivery-challans': live('delivery_challans (0227)'),
  'document-edits': live('document_edit_requests'),
  'goods-receipt-notes': live('goods_receipt_notes'),
  'incoming-qc': live('goods_receipt_notes / purchase_order_lines'),
  'jc-ops-board': live('jc_ops / op_log'),
  'job-cards': live('job_cards / jc_ops'),
  'job-queue': live('job_cards / jc_ops'),
  'ml-boms': live('ml_boms / ml_bom_lines (0227)'),
  'ml-plans': live('ml_plans / ml_plan_nodes (0227)'),
  'nc-register': live('nc_register (0227)'),
  'op-entry': live('jc_ops / op_log'),
  plans: live('production_orders / route_cards'),
  'production-dashboard': live('job_cards / jc_ops'),
  'production-orders': live('production_orders'),
  'purchase-orders': live('purchase_orders / lines'),
  'purchase-requests': live('purchase_requests'),
  'qc-command': live('jc_ops / op_log'),
  'qc-documents': live('qc_documents (0227)'),
  'qc-history': live('op_log / GRN'),
  'route-cards': live('route_cards / route_card_ops (0227)'),
  'sales-orders': live('sales_orders / lines'),
  'shop-floor': live('job_cards / jc_ops'),
  'so-documents': live('qc_documents (0227)'),
  'so-overview': live('sales orders + production'),
  'so-planning': live('production_orders / route_cards'),
  'so-status': live('sales orders + production'),

  // ── Poll (60 s safety refresh) ──
  alerts: poll('alert rules over many tables'),
  assemblies: poll('assembly tables are not published'),
  'customer-material-returns': poll('not published'),
  'daily-report': poll('legacy daily report view'),
  'design-issues': poll('design tables are not published'),
  'design-projects': poll('design tables are not published'),
  'design-tracker': poll('design tables are not published'),
  'design-work-log': poll('design tables are not published'),
  invoices: poll('invoices not published (amounts; changes rarely)'),
  'job-work-orders': poll('job_work_orders not published'),
  'jw-dc': poll('not published'),
  'jw-invoices': poll('not published'),
  'jw-returns': poll('not published'),
  'machine-loading': poll('derived from ops + machines'),
  'osp-wip': poll('derived view'),
  'party-grn': poll('not published'),
  'party-material-issues': poll('not published'),
  'party-materials': poll('not published'),
  'party-stock-ledger': poll('ledger, not published'),
  'pending-so-value': poll('derived view'),
  'production-schedule': poll('derived view'),
  'store-inventory': poll('stock ledger is high volume; polling is cheaper'),
  'store-issues': poll('not published'),
  tasks: poll('tasks carry private to-dos (ADR-254); Realtime would send them to everyone'),
  'tool-issues': poll('not published'),
  tpi: poll('not published'),

  // ── On open / focus ──
  'access-control': onOpen(MASTER),
  'activity-log': onOpen(REPORT),
  'approval-config': onOpen(MASTER),
  backup: onOpen('admin page, status read on open'),
  'bom-masters': onOpen(MASTER),
  capa: onOpen('few records, edited by one QC person at a time'),
  'client-po-check': onOpen(LOOKUP),
  clients: onOpen(MASTER),
  company: onOpen(MASTER),
  'cost-centers': onOpen(MASTER),
  'daily-task-reports': onOpen(REPORT),
  'doc-number': onOpen(LOOKUP),
  'flow-views': onOpen(REPORT),
  'global-search': onOpen(LOOKUP),
  instruments: onOpen(MASTER),
  'item-image': onOpen(LOOKUP),
  items: onOpen(MASTER),
  'jc-drawing': onOpen(LOOKUP),
  'jwso-documents': onOpen('JWSO documents tab, read on open'),
  'machine-groups': onOpen(MASTER),
  machines: onOpen(MASTER),
  material: onOpen('JC / SO material tab, read on open'),
  'material-grades': onOpen(MASTER),
  'material-sizes': onOpen(MASTER),
  me: onOpen("the user's own preferences"),
  'op-log': onOpen('history report; Op Entry is the live screen'),
  operators: onOpen(MASTER),
  'print-templates': onOpen(MASTER),
  'qc-processes': onOpen(MASTER),
  'related-docs': onOpen(LOOKUP),
  'report-types': onOpen(MASTER),
  reports: onOpen(REPORT),
  'saved-reports': onOpen(REPORT),
  'sc-dashboard': onOpen(REPORT),
  session: onOpen('login session'),
  'so-costing': onOpen(REPORT),
  'so-cycle-time': onOpen(REPORT),
  'so-drawing-history': onOpen(LOOKUP),
  'so-qc-status': onOpen(REPORT),
  'so-timeline': onOpen(REPORT),
  'stock-counts': onOpen('count sheets, one counter at a time'),
  'stock-valuation': onOpen(REPORT),
  'store-transactions': onOpen(REPORT),
  'stock-reservations': onOpen('reservation panel, read when the plan / SO opens'),
  'stuck-dashboard': onOpen(REPORT),
  'tpi-masters': onOpen(MASTER),
  trash: onOpen('admin page'),
  users: onOpen(MASTER),
  vendors: onOpen(MASTER),
};

/** Roots built by helpers the scan cannot see as a literal (`['me', …]`,
 *  `sessionQueryKey`). Kept here so the test knows they are real. */
export const ROOTS_DEFINED_BY_HELPERS: readonly string[] = ['me', 'session'];
