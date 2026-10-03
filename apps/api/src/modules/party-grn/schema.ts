// Party GRN module-local edit schema (ADR-202 Phase 3).
//
// packages/shared is frozen, so the edit-approval payload for Party GRN lives
// here, next to its service. It matches the frontend edit payload: the editable
// HEADER fields, plus the lines array carrying ONLY the per-line fields a line
// still waiting for Incoming QC may change (receivedQty + remarks), plus the
// optional reason and the optimistic-lock token. Every field is optional — a
// header-only edit sends no lines; a line-only edit sends no header field.

import { z } from 'zod';

/** One edited Party GRN line. `id` is the line's stable uuid. Only a line still
 *  waiting for Incoming QC may be edited (enforced in the service), and only its
 *  received qty and remarks. */
export const updatePartyGrnLineInputSchema = z.object({
  id: z.string().uuid(),
  receivedQty: z.number().int().positive().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type UpdatePartyGrnLineInput = z.infer<typeof updatePartyGrnLineInputSchema>;

/** The Party GRN edit payload. Header fields are flat at the top level; `lines`
 *  carries only waiting-QC line changes. `reason` / `expectedUpdatedAt` are the
 *  edit-approval extras (reason shown on the request, token for the §20.4 check). */
export const updatePartyGrnInputSchema = z.object({
  grnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dcNo: z.string().trim().max(64).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  receivedByText: z.string().trim().max(200).nullable().optional(),
  lines: z.array(updatePartyGrnLineInputSchema).optional(),
  reason: z.string().trim().max(500).optional(),
  expectedUpdatedAt: z.string().optional(),
});
export type UpdatePartyGrnInput = z.infer<typeof updatePartyGrnInputSchema>;
