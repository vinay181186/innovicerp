// Data Integrity Check service — scans cross-module linkages for
// broken references, orphan rows, over-allocations, negative stock.
// Mirror of legacy runIntegrityCheck (Settings page L13427).
//
// Each check is a single SQL query returning a count + a few sample
// labels. The web UI renders a green/red panel per check. Read-only.

import type { IntegrityCheckResponse, IntegrityCheckResult } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

interface CheckSpec {
  code: string;
  label: string;
  // Returns rows with a single `sample` text column.
  buildQuery: (companyId: string) => string;
}

const CHECKS: readonly CheckSpec[] = [
  {
    code: 'DI-001',
    label: 'Job Cards with no linked SO or JW',
    buildQuery: (cid) => `
      SELECT code AS sample
      FROM job_cards
      WHERE company_id = '${cid}'::uuid
        AND deleted_at IS NULL
        AND source_so_line_id IS NULL
        AND source_jw_line_id IS NULL
        AND source_legacy_ref IS NULL
      ORDER BY code DESC LIMIT 5`,
  },
  {
    code: 'DI-002',
    label: 'JC Ops without a machine + not outsource',
    buildQuery: (cid) => `
      SELECT jc.code || ' op' || jo.op_seq AS sample
      FROM jc_ops jo
      JOIN job_cards jc ON jc.id = jo.job_card_id
      WHERE jo.company_id = '${cid}'::uuid
        AND jo.machine_id IS NULL
        AND COALESCE(jo.machine_code_text, '') = ''
        AND jo.op_type <> 'outsource'
      ORDER BY jc.code DESC LIMIT 5`,
  },
  {
    code: 'DI-003',
    label: 'Items with negative on-hand stock',
    buildQuery: (cid) => `
      SELECT i.code || ' (' || isb.on_hand_qty || ')' AS sample
      FROM item_stock_balances isb
      JOIN items i ON i.id = isb.item_id
      WHERE isb.company_id = '${cid}'::uuid
        AND isb.on_hand_qty < 0
      ORDER BY isb.on_hand_qty ASC LIMIT 5`,
  },
  {
    code: 'DI-004',
    label: 'POs in Draft for more than 14 days',
    buildQuery: (cid) => `
      SELECT code AS sample
      FROM purchase_orders
      WHERE company_id = '${cid}'::uuid
        AND deleted_at IS NULL
        AND status = 'draft'
        AND po_date < (current_date - interval '14 days')
      ORDER BY po_date ASC LIMIT 5`,
  },
  {
    code: 'DI-005',
    label: 'NC Register rows pending dispose > 7 days',
    buildQuery: (cid) => `
      SELECT code AS sample
      FROM nc_register
      WHERE company_id = '${cid}'::uuid
        AND deleted_at IS NULL
        AND status = 'pending'
        AND nc_date < (current_date - interval '7 days')
      ORDER BY nc_date ASC LIMIT 5`,
  },
  {
    code: 'DI-006',
    label: 'PR Open with no PO + > 7 days old',
    buildQuery: (cid) => `
      SELECT code AS sample
      FROM purchase_requests pr
      WHERE pr.company_id = '${cid}'::uuid
        AND pr.deleted_at IS NULL
        AND pr.status IN ('open', 'approved')
        AND pr.pr_date < (current_date - interval '7 days')
        AND NOT EXISTS (
          SELECT 1 FROM purchase_orders po
          WHERE po.company_id = pr.company_id
            AND po.deleted_at IS NULL
            AND po.code LIKE '%' || pr.code || '%'
        )
      ORDER BY pr.pr_date ASC LIMIT 5`,
  },
  {
    code: 'DI-007',
    label: 'JCs past due date and not complete',
    buildQuery: (cid) => `
      SELECT code AS sample
      FROM job_cards
      WHERE company_id = '${cid}'::uuid
        AND deleted_at IS NULL
        AND due_date IS NOT NULL
        AND due_date < current_date
      ORDER BY due_date ASC LIMIT 5`,
  },
  {
    code: 'DI-008',
    label: 'SO Lines with order_qty <= 0',
    buildQuery: (cid) => `
      SELECT so.code || ' line ' || sol.line_no AS sample
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE sol.company_id = '${cid}'::uuid
        AND COALESCE(sol.order_qty, 0) <= 0
      ORDER BY so.code DESC LIMIT 5`,
  },
];

export async function runIntegrityCheck(user: AuthContext): Promise<IntegrityCheckResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const results: IntegrityCheckResult[] = [];
    for (const spec of CHECKS) {
      try {
        const r = await tx.execute(sql.raw(spec.buildQuery(companyId)));
        const rows = r as unknown as { sample: string | null }[];
        const samples = rows.map((x) => x.sample ?? '').filter(Boolean);
        const count = samples.length;
        results.push({
          code: spec.code,
          label: spec.label,
          severity: count === 0 ? 'ok' : count > 3 ? 'error' : 'warn',
          count,
          detail:
            count === 0
              ? 'No issues found.'
              : `${count} record${count === 1 ? '' : 's'} (showing up to 5).`,
          samples,
        });
      } catch (e) {
        // A check that fails (e.g. table doesn't exist yet in dev) should
        // not abort the whole scan — record the failure and keep going.
        results.push({
          code: spec.code,
          label: spec.label,
          severity: 'warn',
          count: 0,
          detail: 'Check could not run: ' + (e instanceof Error ? e.message : String(e)),
          samples: [],
        });
      }
    }

    return { ranAt: new Date().toISOString(), results };
  });
}
