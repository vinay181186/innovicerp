// The chips shown under a Planning line's ▸ detail panel (PL-4b): one PR chip
// per purchase request (ADR-171) and one plan chip per plan. Split out of
// routes/workflow.tsx (ADR-199 table standard) so the detail view stays under
// the 400-line rule.
//
// ADR-199 level-2 conversion: these chips are now READ-ONLY. Every action they
// used to carry as a button (Edit plan, ⚡ Create JC / Raise PR, + Production
// Order, View JC) lives in the row's ONE ⋯ menu (planning-line-menu.ts), so a
// line's actions are in a single place instead of inside a chip in a cell. What
// stays here is what the planner READS: the plan's code, type, qty, ops count,
// vendor, status, and real links to the documents it produced.

import {
  PLAN_DERIVED_STATUS_LABEL,
  type PlanDerivedStatus,
  type PlanStatus,
  type PlanningLine,
  type PlanningPlanSummary,
  type PrStatus,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';

// Legacy renders the raw stored status text (`esc(plan.status)`), which in the
// legacy store is Title Case ("In Planning", "JC Created", …). Our enum is
// snake_case, so map back to the legacy label. Same {status → label} shape the
// plans module already uses (routes/list.tsx, detail.tsx, dashboard.tsx).
const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

const PLAN_STATUS_COLOR: Record<PlanStatus, string> = {
  // Same colour per state as <StatusBadge kind="plan"> (wave 2).
  in_planning: 'var(--text3)',
  planned: 'var(--blue)',
  jc_created: 'var(--cyan)',
  pr_created: 'var(--cyan)',
  in_production: 'var(--amber)',
  complete: 'var(--green)',
  cancelled: 'var(--text3)',
};

const DERIVED_STATUS_COLOR: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'var(--text3)',
  gen_production_order: 'var(--blue)',
  in_production: 'var(--amber)',
  production_complete: 'var(--green)',
};

// ADR-171: a purchase request raised from a BUY line, chip label + colour.
const PR_STATUS_LABEL: Record<PrStatus, string> = {
  open: 'Open',
  approved: 'Approved',
  po_created: 'PO Created',
  cancelled: 'Cancelled',
};
const PR_STATUS_COLOR: Record<PrStatus, string> = {
  open: 'var(--amber)',
  approved: 'var(--blue)',
  po_created: 'var(--green)',
  cancelled: 'var(--text3)',
};

/** One plan's status as it reads on screen: the derived label for a route-card
 *  plan (ADR-170), the plan's own status otherwise. ONE helper, so the Plans
 *  COLUMN and the plan chip in the ▸ panel can never show a plan differently. */
export function planStatusOf(plan: PlanningPlanSummary): { label: string; color: string } {
  const isRouteCard = plan.opsSource === 'route_card';
  return isRouteCard && plan.derivedStatus
    ? {
        label: PLAN_DERIVED_STATUS_LABEL[plan.derivedStatus],
        color: DERIVED_STATUS_COLOR[plan.derivedStatus],
      }
    : { label: PLAN_STATUS_LABEL[plan.planStatus], color: PLAN_STATUS_COLOR[plan.planStatus] };
}

/** ADR-216 — WHICH item this plan is for, when that is not the SO line's own
 *  item. A plan on a BOM parent's line is for a CHILD part (ADR-030 grain: one
 *  plan per SO line × BOM child), so the line's item code is the wrong answer
 *  and the chip used to name no part at all. `bomChildCode` is THE
 *  discriminator: null means an ordinary plan, and this returns null so the
 *  chip and the Plans cell render exactly as they did before.
 *
 *  Live value from `items` wins, the plan's own snapshot is the fallback
 *  (`xxx ?? xxxText`, the house pattern the Plans list already uses), and
 *  `bomChildCode` itself — which IS the child's code — is the last resort.
 *
 *  The code is BARE, never `CODE/REV`: the revision in `CODE/REV` is the
 *  CUSTOMER's drawing revision off the PARENT SO line and says nothing about a
 *  child part, so printing one here would be a plausible-looking lie (see
 *  lib/item-code.ts). The contract carries no revision for this reason.
 *
 *  ONE helper, so the Plans COLUMN and the plan chip in the ▸ panel can never
 *  name a plan's part differently — same reason `planStatusOf` exists. */
export function planChildItemOf(
  plan: PlanningPlanSummary,
): { code: string; name: string | null } | null {
  if (plan.bomChildCode === null) return null;
  return {
    code: plan.itemCode ?? plan.itemCodeText ?? plan.bomChildCode,
    name: plan.itemName ?? plan.itemNameText,
  };
}

/** One purchase request's status as it reads on screen — the PO number once one
 *  has been raised from it, which is what the PR chip shows in its place. */
export function prStatusOf(pr: PlanningLine['prs'][number]): { label: string; color: string } {
  return {
    label: pr.status === 'po_created' && pr.poCode ? `PO ${pr.poCode}` : PR_STATUS_LABEL[pr.status],
    color: PR_STATUS_COLOR[pr.status],
  };
}

// ─── PR chip (ADR-171) ───────────────────────────────────────────────────

/** One purchase request raised from a BUY line: 🛒 code (link to the PR) ·
 *  qty · status — the PO code once one is raised from it. */
export function PrChip({ pr }: { pr: PlanningLine['prs'][number] }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '3px 8px',
        margin: '2px 0',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 11,
      }}
    >
      <span>🛒</span>
      <Link
        to="/purchase-requests/$id"
        params={{ id: pr.id }}
        className="mono fw-700"
        style={{ color: 'var(--text)' }}
        title="Open the purchase request"
      >
        {pr.code}
      </Link>
      <span className="text2">
        PR · <b>{pr.qty} pcs</b>
      </span>
      <span style={{ fontWeight: 700, color: PR_STATUS_COLOR[pr.status], fontSize: 11 }}>
        {pr.status === 'po_created' && pr.poCode ? (
          <>
            PO <span className="mono">{pr.poCode}</span>
          </>
        ) : (
          PR_STATUS_LABEL[pr.status]
        )}
      </span>
    </div>
  );
}

// ─── Plan chip ───────────────────────────────────────────────────────────
