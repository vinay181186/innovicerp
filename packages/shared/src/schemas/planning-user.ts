// Planning user options — the people Access Control actually lets do Planning
// work. Third use of the shape QC introduced (qc-user.ts) and Production copied
// (production-user.ts); the server-side logic behind all three is now ONE
// parameterised helper, so a fourth department costs a form-key array and this
// contract, not another 124 lines.
//
// WHY: `Assembled By` on the Assembly Tracker's Start panel was a free-text box,
// so the person who built a machine was whatever anyone typed — unsearchable,
// unlinkable, and spelled differently by every clerk. Access Control already
// knows who Planning is.
//
// WHO QUALIFIES: anyone Access Control GRANTED the right to make a Planning
// entry — `entry` on `plan_create` (SO/JWSO Planning) or `routecard_create`
// (Route Card Master), asked through the app's own `effectiveFormPerms`. Those
// two are the ONLY Planning-department form keys in ACCESS_FORMS. A per-form
// grant counts even without a Planning department tier; a per-page "No create"
// switch takes someone back off it. View-only (L1) falls out on its own — that
// tier grants no entry. The tiers are NOT a ladder (L4 Approver has no entry),
// so this asks the real permission, never a "tier >= L2" comparison.
//
// Full Access COUNTS (those accounts may make any entry), sorted LAST and
// labelled, so an admin is never read as Planning staff. `users.role` is NOT the
// filter — what someone was GRANTED is the honest answer.
//
// DELIBERATELY NOT the Assembly Tracker's own gate. That screen has no form key
// at all: its nav entry is visible to anyone who can see the Planning section,
// and its writes run on a coarse `role ∈ {admin, manager}` check. On the test
// database that admits a Purchase-only manager who cannot even open the Planning
// menu — a wider and different set, so it is no use as "has Planning access".

import { z } from 'zod';

export const planningUserOptionSchema = z.object({
  id: z.string().uuid(),
  /** Display name (short name), falling back to the login email when unset. */
  name: z.string(),
  email: z.string(),
  /** Their Planning tier, display only — it does not decide who is on the list.
   *  Null when someone qualifies through a per-form grant, not a tier. */
  tier: z.string().nullable(),
  /** True when Planning is this person's MAIN department — the actual Planning
   *  team, vs. someone from another department holding a Planning grant. Drives
   *  ordering so the team appears first. */
  isPlanningDept: z.boolean(),
  /** True for a Full Access account — qualifies (may make any entry) but sorts
   *  LAST and the UI labels the row. */
  fullAccess: z.boolean(),
});
export type PlanningUserOption = z.infer<typeof planningUserOptionSchema>;

export const listPlanningUserOptionsResponseSchema = z.object({
  options: z.array(planningUserOptionSchema),
});
export type ListPlanningUserOptionsResponse = z.infer<typeof listPlanningUserOptionsResponseSchema>;
