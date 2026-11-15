// ADR-292 — Item Issue takes a MAKE item from a named Drawing Rev bucket.
//
//   • the slip line's itemRevisionId names the bucket (null = blank bucket);
//   • omitted: the target Job Card's own Rev when the card is for this item and
//     that bucket covers the qty; else the blank bucket when the item has no
//     Rev stock; else refused — "Choose the Drawing Rev to issue";
//   • a Job Card target for this item whose Rev differs from the chosen one is
//     refused with the mismatch sentence, unless an approved substitution for
//     that Job Card covers it — then it is used up against the slip line once
//     that line is written (consumeIssueSubstitution), and Return / Cancel give
//     back exactly what that line used (giveBackIssueRevs, 0251).
// Buy items keep the old behaviour (no Rev named — any bucket).

import { itemRevLabel, type CreateStoreIssueInput } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import {
  consumeSubstitution,
  giveBackSubstitution,
  hasSubstitution,
  revMismatchMessage,
} from '../../lib/rev-substitution';
import { roundQty } from '../../lib/stock-ledger';
import type { GiveBackResult } from '../../lib/stock-out-parts';
import { bucketLabel, readRevBuckets } from '../../lib/stock-reservation';

interface JcRev {
  code: string;
  itemId: string | null;
  revId: string | null;
}

async function readJcRev(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string | null,
): Promise<JcRev | null> {
  if (!jobCardId) return null;
  const rows = (await tx.execute(sql`
    SELECT code, item_id AS "itemId", item_revision_id AS "revId"
      FROM public.job_cards
     WHERE id = ${jobCardId}::uuid AND company_id = ${companyId}::uuid`)) as unknown as JcRev[];
  return rows[0] ?? null;
}

async function revTexts(tx: DbTransaction, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await tx.execute(sql`
    SELECT id, rev FROM public.item_revisions
     WHERE id = ANY(${sql.param(ids)}::uuid[])`)) as unknown as Array<{ id: string; rev: string }>;
  return new Map(rows.map((r) => [r.id, r.rev]));
}

/** A substitution a slip line needs — used up once the line is written. */
export interface IssueSubstitution {
  jobCardId: string;
  fromRevId: string;
  toRevId: string;
  qty: number;
  usedLabel: string;
  askedLabel: string;
}

/**
 * The bucket of every slip line (index-aligned): a uuid / null = that bucket,
 * undefined = a Buy item (no Rev named), plus the substitution each line needs
 * (null = none). A line needing one with no approved substitution is refused
 * here, before anything is written. Call after the items are locked (the
 * bucket figures are then the real ones).
 */
export async function resolveIssueRevs(
  tx: DbTransaction,
  companyId: string,
  lines: CreateStoreIssueInput['lines'],
  jobCardId: string | null,
  itemCodes: Map<string, string>,
): Promise<{ revs: Array<string | null | undefined>; subs: Array<IssueSubstitution | null> }> {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const make = (await tx.execute(sql`
    SELECT id FROM public.items
     WHERE company_id = ${companyId}::uuid AND id = ANY(${sql.param(ids)}::uuid[])
       AND procurement_type::text = 'make'`)) as unknown as Array<{ id: string }>;
  const makeIds = new Set(make.map((r) => r.id));
  if (makeIds.size === 0) return { revs: lines.map(() => undefined), subs: lines.map(() => null) };
  const buckets = await readRevBuckets(tx, companyId, [...makeIds]);
  const jc = await readJcRev(tx, companyId, jobCardId);
  const texts = await revTexts(tx, [
    ...new Set(
      [
        jc?.revId ?? null,
        ...lines.map((l) => l.itemRevisionId ?? null),
        ...[...buckets.values()].flat().map((b) => b.itemRevisionId),
      ].filter((v): v is string => !!v),
    ),
  ]);
  const label = (itemId: string, revId: string | null): string =>
    bucketLabel(itemCodes.get(itemId) ?? '', revId ? (texts.get(revId) ?? '?') : null);

  const out: Array<string | null | undefined> = [];
  const subs: Array<IssueSubstitution | null> = [];
  for (const l of lines) {
    if (!makeIds.has(l.itemId)) {
      out.push(undefined);
      subs.push(null);
      continue;
    }
    const code = itemCodes.get(l.itemId) ?? '';
    const inStock = (buckets.get(l.itemId) ?? []).filter((b) => b.onHandQty > 0);
    const jcRev = jc && jc.itemId === l.itemId ? jc.revId : null;
    let rev: string | null;
    if (l.itemRevisionId !== undefined) {
      rev = l.itemRevisionId;
    } else if (
      jcRev &&
      inStock.some((b) => b.itemRevisionId === jcRev && b.onHandQty >= roundQty(l.qty))
    ) {
      rev = jcRev;
    } else if (inStock.every((b) => b.itemRevisionId === null)) {
      rev = null;
    } else {
      throw new ValidationError(
        `${code}: Choose the Drawing Rev to issue — In Stock by Drawing Rev: ` +
          `${inStock.map((b) => `${label(l.itemId, b.itemRevisionId)} ${roundQty(b.onHandQty)}`).join(', ')}.`,
      );
    }
    if (jc && jcRev && rev !== jcRev) {
      const askedLabel = itemRevLabel(code, texts.get(jcRev) ?? '?');
      const usedLabel = label(l.itemId, rev);
      if (!rev) {
        throw new ConflictError(
          `${revMismatchMessage(usedLabel, askedLabel, 'Job Card')} Set the Drawing Rev on that stock first.`,
        );
      }
      const scope = { jobCardId: jobCardId! };
      if (!(await hasSubstitution(tx, { companyId, scope, fromRevId: rev, toRevId: jcRev }))) {
        throw new ConflictError(revMismatchMessage(usedLabel, askedLabel, 'Job Card'));
      }
      subs.push({
        jobCardId: jobCardId!,
        fromRevId: rev,
        toRevId: jcRev,
        qty: roundQty(l.qty),
        usedLabel,
        askedLabel,
      });
    } else {
      subs.push(null);
    }
    out.push(rev);
  }
  return { revs: out, subs };
}

/** Use up a slip line's substitution, recorded against that line (§20.3 —
 *  the qty left is checked under the substitution's lock). */
export async function consumeIssueSubstitution(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  sub: IssueSubstitution | null,
  storeIssueLineId: string,
): Promise<void> {
  if (!sub) return;
  await consumeSubstitution(tx, {
    companyId,
    userId,
    scope: { jobCardId: sub.jobCardId },
    fromRevId: sub.fromRevId,
    toRevId: sub.toRevId,
    qty: sub.qty,
    source: { type: 'store_issue_line', id: storeIssueLineId },
    usedLabel: sub.usedLabel,
    askedLabel: sub.askedLabel,
    against: 'Job Card',
  });
}

/** Return / Cancel: the pieces that came back from a substituted bucket give
 *  back what THIS slip line used of the substitution — read off its use rows,
 *  so a Job Card Rev moved since the issue changes nothing. */
export async function giveBackIssueRevs(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  storeIssueLineId: string,
  back: GiveBackResult[],
): Promise<void> {
  for (const b of back) {
    if (!b.itemRevisionId) continue;
    await giveBackSubstitution(tx, {
      companyId,
      userId,
      source: { type: 'store_issue_line', id: storeIssueLineId },
      qty: b.qty,
      fromRevId: b.itemRevisionId,
    });
  }
}
