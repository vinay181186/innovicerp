// QC user options — the people Access Control actually lets do QC work.
//
// Every "QC By" box in the app was free text, or a list of OPERATOR names,
// which is the wrong list twice over: operators are shop-floor machinists, and
// a typed name links an inspection to nobody. Access Control already knows who
// the QC people are — the user configures it there — so that is where the
// dropdown comes from.
//
// WHO QUALIFIES: anyone Access Control GRANTED the right to create a QC entry
// — that is, `entry` on QC Call Register or Incoming QC, asked through the
// app's own `effectiveFormPerms`. So a per-form grant counts even without a
// Quality tier, and a per-page "No create" switch takes someone back off it.
//
// Asking the real permission table matters because THE TIERS ARE NOT A LADDER:
// L4 is Approver — view and approve, NO entry — so it ranks above L3 while
// granting less. Any "tier >= L2" comparison lets an Approver through, which is
// how a Quality L4 ended up being offered as someone who records inspections.
// L1 falls out on its own for the same reason: that tier grants no entry.
//
// Full Access COUNTS. Those accounts may make any entry in the system, QC
// included, so a list of who may do it that left them out would be describing
// something untrue — and an admin could not then be recorded as the inspector
// on work they really did. They are sorted LAST instead, below the QC team and
// below everyone holding a real QC grant, so the dropdown still opens on the
// people whose job this is.
//
// `users.role` is NOT the filter, even though it has a 'qc' value. That role is
// derived as "the narrowest role covering everything they were given"
// (roleForAccess), so a Quality lead who also writes Production derives as
// 'manager' and would vanish from the list, while a Quality L1 derives as
// 'viewer'. What someone was GRANTED is the honest answer.

import { z } from 'zod';

export const qcUserOptionSchema = z.object({
  id: z.string().uuid(),
  /** Display name, falling back to the login email when no name is set. */
  name: z.string(),
  email: z.string(),
  /** Their Quality tier, for display only — it no longer decides who is on the
   *  list. Null when someone qualifies through a per-form grant rather than a
   *  department tier. */
  tier: z.string().nullable(),
  /** True when Quality is this person's MAIN department — the actual QC team,
   *  as opposed to someone from another department holding a QC grant. Drives
   *  ordering so the QC team appears first in the dropdown. */
  isQcDept: z.boolean(),
  /** True for a Full Access account. Those qualify because they genuinely may
   *  make any entry — but they sort LAST, and the UI labels the row, so an
   *  admin is never read as QC staff. */
  fullAccess: z.boolean(),
});
export type QcUserOption = z.infer<typeof qcUserOptionSchema>;

export const listQcUserOptionsResponseSchema = z.object({
  options: z.array(qcUserOptionSchema),
});
export type ListQcUserOptionsResponse = z.infer<typeof listQcUserOptionsResponseSchema>;
