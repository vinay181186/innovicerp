// ADR-230 — the ONE list of tables whose changes reach other PCs live.
//
// Every layer reads this list and nothing else:
//   web   lib/live-updates/table-keys.ts — which screens each table refreshes
//         (typed `Record<LiveTable, …>`, so a table added here and not mapped
//         there fails the build instead of silently refreshing nothing)
//   db    the Realtime publication migration (v1) names the same tables
//   api   the change feed (v2 push / v3 poll) emits only these names
//
// A change message is a doorbell, never data: it says WHICH record changed and
// the screen re-reads it through the normal API. So a late, duplicated or
// out-of-order message can never put a wrong figure on screen.

export const LIVE_TABLES = [
  'job_cards',
  'jc_ops',
  'op_log',
  'sales_orders',
  'sales_order_lines',
  'purchase_orders',
  'purchase_order_lines',
  'purchase_requests',
  'goods_receipt_notes',
  'document_edit_requests',
] as const;

export type LiveTable = (typeof LIVE_TABLES)[number];

/** One changed record. `id` is null when the source cannot name the row
 *  (e.g. a delete seen without its old row) — the table's screens still refresh. */
export interface LiveChange {
  table: LiveTable;
  id: string | null;
}

const LIVE_TABLE_SET: ReadonlySet<string> = new Set(LIVE_TABLES);

export function isLiveTable(name: string): name is LiveTable {
  return LIVE_TABLE_SET.has(name);
}
