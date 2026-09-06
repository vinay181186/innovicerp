// QC user options — the people Access Control actually lets do QC work.
//
// Every "QC By" box in the app was free text, or a list of OPERATOR names,
// which is the wrong list twice over: operators are shop-floor machinists, and
// a typed name links an inspection to nobody. Access Control already knows who
// the QC people are — the user configures it there — so that is where the
// dropdown comes from.
//
// WHO QUALIFIES (and why it is not simply "has QC ticked"):
//   - anyone whose Quality department tier is L2 or above, and
//   - anyone with Full Access (they can do everything, including this).
// L1 is deliberately EXCLUDED. L1 is view-only, so an L1 grant means "may look
// at Quality screens", not "may sign off an inspection" — offering them as an
// inspector would name someone who cannot legally do the job. On the live data
// that distinction matters: 18 accounts carry some QC grant, but 5 of them are
// L1 people from Production, Design and Purchase who only need to read.
//
// `users.role` is NOT the filter, even though it has a 'qc' value. That role is
// derived as "the narrowest role covering everything they were given"
// (roleForAccess), so a Quality lead who also writes Production derives as
// 'manager' and would vanish from the list, while a Quality L1 derives as
// 'viewer'. The department tier is the honest answer.

import { z } from 'zod';

export const qcUserOptionSchema = z.object({
  id: z.string().uuid(),
  /** Display name, falling back to the login email when no name is set. */
  name: z.string(),
  email: z.string(),
  /** Their Quality tier ('L2'…'L5'), or null for a Full Access account that
   *  qualifies without a Quality grant of its own. */
  tier: z.string().nullable(),
  /** True when Quality is this person's MAIN department — the actual QC team,
   *  as opposed to someone from another department holding a QC grant. Drives
   *  ordering so the QC team appears first in the dropdown. */
  isQcDept: z.boolean(),
  /** True for a Full Access account. Listed because they genuinely may do the
   *  work, flagged so the UI can say so rather than implying they are QC staff. */
  fullAccess: z.boolean(),
});
export type QcUserOption = z.infer<typeof qcUserOptionSchema>;

export const listQcUserOptionsResponseSchema = z.object({
  options: z.array(qcUserOptionSchema),
});
export type ListQcUserOptionsResponse = z.infer<typeof listQcUserOptionsResponseSchema>;
