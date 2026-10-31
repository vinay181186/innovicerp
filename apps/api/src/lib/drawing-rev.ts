import { sql, type SQL } from 'drizzle-orm';

// Drawing Rev register (owner 2026-10-31): plans, Production Orders and Job
// Cards STORE item_revision_id. Every read that shows a document's Rev reads it
// through here — the document's own Rev first, the SO / JWSO line text only as
// the fallback for documents made before the register (a split line can have
// JC-1 at ABC/1 and JC-2 at ABC/2, so the line text alone is not the answer).

/** The Rev text of an item_revision_id column/expression already in the query
 *  (scalar primary-key lookup; null when the document names no Rev). */
export function drawingRevOf(itemRevisionId: unknown): SQL<string | null> {
  return sql<
    string | null
  >`(SELECT ir.rev FROM public.item_revisions ir WHERE ir.id = ${itemRevisionId})`;
}
