// Production user options — the people Access Control actually lets do
// Production work. Mirrors the QC-user picker (see qc-user.ts): the "Issued To"
// box on Issue from Store was a list of OPERATOR names (shop-floor machinists),
// which links the issue to the wrong set of people. Access Control already
// knows who Production is, so that is where the dropdown comes from.
//
// WHO QUALIFIES (owner decision 3b): anyone Access Control GRANTED the right to
// make a Production entry — `entry` on any Production form (Job Cards,
// Production Orders, Op Entry, Machine Op Entry, Machine / Operator / Raw
// Material Master), asked through the app's own `effectiveFormPerms`. A per-form
// grant counts even without a Production department tier; a per-page "No create"
// switch takes someone back off it. View-only (L1) falls out on its own — that
// tier grants no entry. The tiers are NOT a ladder (L4 Approver has no entry),
// so this asks the real permission, never a "tier >= L2" comparison.
//
// Full Access COUNTS (those accounts may make any entry), sorted LAST and
// labelled, so an admin is never read as Production staff. `users.role` is NOT
// the filter — what someone was GRANTED is the honest answer.

import { z } from 'zod';

export const productionUserOptionSchema = z.object({
  id: z.string().uuid(),
  /** Display name (short name), falling back to the login email when unset. */
  name: z.string(),
  email: z.string(),
  /** Their Production tier, display only — it does not decide who is on the
   *  list. Null when someone qualifies through a per-form grant, not a tier. */
  tier: z.string().nullable(),
  /** True when Production is this person's MAIN department — the actual
   *  Production team, vs. someone from another department holding a Production
   *  grant. Drives ordering so the team appears first. */
  isProductionDept: z.boolean(),
  /** True for a Full Access account — qualifies (may make any entry) but sorts
   *  LAST and the UI labels the row. */
  fullAccess: z.boolean(),
});
export type ProductionUserOption = z.infer<typeof productionUserOptionSchema>;

export const listProductionUserOptionsResponseSchema = z.object({
  options: z.array(productionUserOptionSchema),
});
export type ListProductionUserOptionsResponse = z.infer<
  typeof listProductionUserOptionsResponseSchema
>;
