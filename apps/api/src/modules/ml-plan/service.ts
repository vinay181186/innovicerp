// Multi-Level Plan service (ADR-225 phase 3). The entry point the routes
// call: access checks (`mlplan_create`, dept Planning) and the transaction.
// The work lives in
//   reads.ts          list / detail / next code / eligible SO lines
//   writes.ts         create / update / refresh / cancel
//   orders.ts         raise orders (plans / PRs) from the rows (phase 4)
//   order-reads.ts    Raised per row, the orders list, live orders
//   snapshot.ts       tree copy + pools + node replace (the one writer of
//                     ml_plan_nodes)
//   snapshot-math.ts  the figures, pure
//   guards.ts         eligibility rule + the guards SO / plans call
//
// Audit (ADR-197): CREATE / EDIT / CANCEL rows land in activity_log with
// entity 'MlPlan' + entityId, so the plan's History panel finds them.

import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireCompany } from '../ml-bom/helpers';
import { listEligibleLinesTx, listMlPlansTx, loadMlPlanDetail, peekNextMlPlanCode } from './reads';
import { raiseMlPlanOrdersTx } from './orders';
import { cancelMlPlanTx, createMlPlanTx, refreshMlPlanTx, updateMlPlanTx } from './writes';
import type {
  CancelMlPlanInput,
  CreateMlPlanInput,
  ListMlPlansQuery,
  ListMlPlansResponse,
  MlPlanDetail,
  MlPlanEligibleLinesQuery,
  MlPlanEligibleLinesResponse,
  RaiseMlPlanOrdersInput,
  RefreshMlPlanInput,
  UpdateMlPlanInput,
} from './schema';

const FORM = 'mlplan_create';

// ─── Reads ───────────────────────────────────────────────────────────────

export async function listMlPlans(
  input: ListMlPlansQuery,
  user: AuthContext,
): Promise<ListMlPlansResponse> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => listMlPlansTx(tx, companyId, input));
}

/** Preview of the next IN-MLP-##### — the real number is taken on save. */
export async function getNextMlPlanCode(user: AuthContext): Promise<{ code: string }> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await peekNextMlPlanCode(tx, companyId) }));
}

export async function listEligibleLines(
  input: MlPlanEligibleLinesQuery,
  user: AuthContext,
): Promise<MlPlanEligibleLinesResponse> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({
    lines: await listEligibleLinesTx(tx, companyId, input),
  }));
}

export async function getMlPlan(id: string, user: AuthContext): Promise<MlPlanDetail> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadMlPlanDetail(tx, id, companyId));
}

// ─── Writes ──────────────────────────────────────────────────────────────

export async function createMlPlan(
  input: CreateMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => createMlPlanTx(tx, companyId, input, user));
}

export async function updateMlPlan(
  id: string,
  input: UpdateMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => updateMlPlanTx(tx, companyId, id, input, user));
}

export async function refreshMlPlan(
  id: string,
  input: RefreshMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => refreshMlPlanTx(tx, companyId, id, input, user));
}

export async function cancelMlPlan(
  id: string,
  input: CancelMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => cancelMlPlanTx(tx, companyId, id, input, user));
}

/** ADR-225 phase 4 — raise plans / PRs from the chosen rows (one
 *  transaction; the first order releases the plan). */
export async function raiseMlPlanOrders(
  id: string,
  input: RaiseMlPlanOrdersInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => raiseMlPlanOrdersTx(tx, companyId, id, input, user));
}
