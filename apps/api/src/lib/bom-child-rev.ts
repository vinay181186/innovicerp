import { and, eq, inArray } from 'drizzle-orm';
import { items } from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';
import { resolveItemRevision } from './item-revision';

// D2 (owner 2026-10-31): a BOM child line names the child part's Item + Drawing
// Rev (SHAFT/2). Shared by BOM Master and Multi-Level BOM so the rule lives in
// one place. The register row itself is written by resolveItemRevision (the
// ONE writer of item_revisions), inside the BOM's own save transaction.

export interface BomChildRevLine {
  childItemId: string;
  /** undefined = not sent (keep the stored Rev of the same child on an edit);
   *  null / '' = no Rev. */
  childDrawingRev?: string | null | undefined;
}

/**
 * The child_item_revision_id for every line, in line order.
 *   • MAKE child: Drawing Rev compulsory — "Ln N: Drawing Rev is required for
 *     <code>". EXCEPT an old line kept on an edit: the same child that is
 *     stored today with NO Rev may be re-saved without one (owner: existing
 *     BOM lines with no Rev stay valid; no forced backfill).
 *   • Rev not sent at all on an edit → the stored Rev of the same child is kept.
 *   • BUY child / raw material: always null (a typed Rev is ignored).
 */
export async function resolveBomChildRevs(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  lines: readonly BomChildRevLine[],
  opts: {
    sourceType: 'bom_line' | 'ml_bom_line';
    /** BOM code for the register history ("IN-BOM-00012"). */
    bomRef: string;
    /** On an edit: the lines stored before it, child item → stored Rev id. */
    stored?: ReadonlyMap<string, string | null>;
  },
): Promise<Array<string | null>> {
  const ids = Array.from(new Set(lines.map((l) => l.childItemId)));
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: items.id, code: items.code, procurementType: items.procurementType })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out: Array<string | null> = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const it = byId.get(l.childItemId);
    if (it?.procurementType !== 'make') {
      out.push(null);
      continue;
    }
    const typed = l.childDrawingRev?.trim() ?? '';
    if (typed === '') {
      const has = opts.stored?.has(l.childItemId) ?? false;
      const storedRev = has ? (opts.stored!.get(l.childItemId) ?? null) : undefined;
      if (l.childDrawingRev === undefined && storedRev) {
        out.push(storedRev); // not sent → keep the stored Rev
        continue;
      }
      if (has && storedRev === null) {
        out.push(null); // an old line with no Rev stays valid
        continue;
      }
      throw new ValidationError(`Ln ${i + 1}: Drawing Rev is required for ${it.code}`);
    }
    const resolved = await resolveItemRevision(tx, user, companyId, {
      itemId: l.childItemId,
      rev: typed,
      sourceType: opts.sourceType,
      sourceRef: `${opts.bomRef} ln ${i + 1}`,
    });
    out.push(resolved?.id ?? null);
  }
  return out;
}
