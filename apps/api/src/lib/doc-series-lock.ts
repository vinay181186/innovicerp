// Race-safe document numbering — one lock per company per number series.
//
// Every document number in the ERP (IN-MPO-00311/R1, IN-GRN-00044, JC-0123 …)
// is picked as "highest number already used + 1" inside the create
// transaction. Without a lock, two users saving at the same moment both read
// the same highest number, both pick the same next one, and the slower save
// hits the `<table>_company_code_uniq` index and is thrown away (S2).
//
// `lockDocSeries` is the ERPNext Naming Series guarantee (the row lock on the
// series counter) without a counter table: a transaction-scoped advisory lock
// keyed on (company, series). The second save WAITS at this line until the
// first commits; its "highest number" read then runs after the winner's row is
// visible (READ COMMITTED takes a fresh snapshot per statement), so it picks
// the next number instead of the same one. The lock is released at commit or
// rollback — nothing to clean up, nothing stored.
//
// The series key is the TABLE the number lives in, not its prefix: every code
// in one table shares one unique index, so two prefixes in the same table
// (IN-DC- for an OSP challan and for a return-to-vendor challan, JC- and
// JC-BOM- job cards, the four PO type series) must also queue behind one lock.
// Taking the same lock again inside the same transaction is free (advisory
// locks stack), so a create that mints several numbers of one series — a BOM
// cascade raising three job cards — is fine.
//
// Call it BEFORE reading the highest number, in the SAME transaction that
// inserts the row. A number picked in one transaction and inserted in another
// is not protected by this lock.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

/** The number series that are locked through this helper. One entry per
 *  table that holds a document code (the unique index's table). */
export type DocSeries =
  | 'purchase_orders'
  | 'purchase_requests'
  | 'plans'
  | 'job_cards'
  | 'goods_receipt_notes'
  | 'delivery_challans'
  | 'delivery_challan_receipts'
  | 'jw_dc_outward'
  | 'jw_dc_inward'
  | 'party_grn'
  | 'customer_dispatches'
  | 'invoices'
  | 'jw_invoices'
  | 'jw_return_challans'
  | 'party_material_issues'
  | 'party_materials'
  | 'customer_material_returns'
  | 'route_cards'
  | 'bom_masters'
  | 'ml_boms'
  // ADR-227 — these seven had no protection at all: no lock and no retry, so
  // two saves in the same second both read the same highest number and the
  // loser's whole transaction was thrown away with a bare "already exists".
  | 'tasks'
  | 'capa_records'
  | 'design_tracker'
  | 'design_projects'
  | 'design_dcrs'
  | 'design_dcns';

/** Serialise number picking for one series of one company until this
 *  transaction ends. See the file header.
 *
 *  NOT the only way to be safe. `assembly_units` numbers a batch WITHIN one
 *  sales order and is serialised instead by `lockSoRow` — `SELECT … FROM
 *  sales_orders … FOR NO KEY UPDATE` — taken at the top of every path that
 *  reads `MAX(unit_no)` (ADR-193 M15). That gives the same guarantee at the
 *  right grain, so two different orders never wait on each other, and it is not
 *  listed above. A series belongs here when its register is company-wide, which
 *  a document number's is. */
export async function lockDocSeries(
  tx: DbTransaction,
  companyId: string,
  series: DocSeries,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`doc_series:${series}:${companyId}`}))`,
  );
}
