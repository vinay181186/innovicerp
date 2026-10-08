import { z } from 'zod';

// R5 / §20.4 — edit conflict (ERPNext "Document has been modified after you have
// opened it"). An edit form sends the `updatedAt` it LOADED as
// `expectedUpdatedAt`; the API compares it with the row's current `updated_at`
// under the row lock and refuses with 409 `edit_conflict` when someone else
// saved in between. Optional, so an older client (or a script) still works —
// it just gets last-write-wins as before. Every form of ours sends it.
//
// ADR-225 — the refusal now carries WHO saved and WHEN, because §20.4 asks for
// "changed by <name> at <time>" and the bare message could not say either. The
// screen uses them for its notice; it also auto-retries once onto the fresh row
// (see apps/web/src/lib/save-with-merge.ts), so for a user who edited different
// fields from the other person this 409 is never seen at all.

/** The `updatedAt` the edit form loaded (ISO timestamp). */
export const expectedUpdatedAtSchema = z.string().trim().min(1).max(64).optional();

export const EDIT_CONFLICT_CODE = 'edit_conflict';
export const EDIT_CONFLICT_MESSAGE = 'Changed by someone else after you opened it — reload';

/**
 * What the 409 carries in `details` so the screen can name the other person.
 *
 * `changedByName` is null when the row's `updated_by` points at a login that no
 * longer resolves (deleted user, or a row last touched by a migration) — the
 * screen then says "someone else", never "null".
 */
export const editConflictDetailsSchema = z.object({
  changedByName: z.string().nullable(),
  /** The row's current `updated_at`, ISO. */
  changedAt: z.string(),
});
export type EditConflictDetails = z.infer<typeof editConflictDetailsSchema>;

/** True when this error is the edit-conflict 409, whatever threw it. */
export function isEditConflictCode(code: unknown): boolean {
  return code === EDIT_CONFLICT_CODE;
}

/**
 * `details` off a 409, if it really is the edit-conflict shape. Returns null
 * for anything else, so a caller can fall back to the plain message rather
 * than trusting a payload it did not recognise.
 */
export function parseEditConflictDetails(details: unknown): EditConflictDetails | null {
  const r = editConflictDetailsSchema.safeParse(details);
  return r.success ? r.data : null;
}
