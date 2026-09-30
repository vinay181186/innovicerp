import { z } from 'zod';

// R5 — edit conflict (ERPNext "Document has been modified after you have
// opened it"). An edit form sends the `updatedAt` it LOADED as
// `expectedUpdatedAt`; the API compares it with the row's current `updated_at`
// under the row lock and refuses with 409 `edit_conflict` when someone else
// saved in between. Optional, so an older client (or a script) still works —
// it just gets last-write-wins as before. Every form of ours sends it.

/** The `updatedAt` the edit form loaded (ISO timestamp). */
export const expectedUpdatedAtSchema = z.string().trim().min(1).max(64).optional();

export const EDIT_CONFLICT_CODE = 'edit_conflict';
export const EDIT_CONFLICT_MESSAGE = 'Changed by someone else after you opened it — reload';
