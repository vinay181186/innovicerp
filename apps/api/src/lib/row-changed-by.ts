// ADR-225 — who last changed this row, as a name a person can read.
//
// §20.4 asks the edit-conflict refusal to say "changed by <name> at <time>".
// `assertUnchangedSinceOpened` takes the name as an argument rather than
// looking it up itself, because that file is pure (no database imports) and is
// unit-tested as such. This is the one lookup, so that twelve update services
// do not each grow their own and drift — which is exactly what happened to
// `listQcUserOptions` / `listProductionUserOptions` before ADR-221 collapsed
// them.
//
// Call it ONLY on the refusal path. The happy path must not pay for a query
// that exists to populate an error message:
//
//   const cur = (await tx.select(...).from(t).where(eq(t.id, id)).for('update'))[0];
//   if (editConflicts(cur.updatedAt, input.expectedUpdatedAt)) {
//     assertUnchangedSinceOpened(
//       cur.updatedAt,
//       input.expectedUpdatedAt,
//       await rowChangedByName(tx, cur.updatedBy),
//     );
//   }
//
// `editConflicts` is the cheap predicate for that guard; `assertUnchanged-
// SinceOpened` then re-checks and throws, so the two can never disagree about
// what counts as a conflict.

import { eq } from 'drizzle-orm';
import { shortName } from '@innovic/shared';
import { users } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { timestampMs } from './edit-conflict';

/**
 * True when the row has moved since the form loaded it — the same comparison
 * `assertUnchangedSinceOpened` makes, exposed so a caller can decide whether
 * the name lookup is worth doing before it throws.
 *
 * A missing `expected` (an older client, or a script) is NOT a conflict: that
 * caller keeps last-write-wins, deliberately.
 */
export function editConflicts(
  current: Date | string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (expected === undefined || expected === null || expected === '') return false;
  if (current === null || current === undefined) return false;
  const sentMs = timestampMs(expected);
  if (Number.isNaN(sentMs)) return false; // let the assert raise the 400
  return timestampMs(current) !== sentMs;
}

/**
 * The display name behind a row's `updated_by`, or null when it cannot be
 * resolved — a deleted login, or a row last written by a migration, which has
 * no user at all. The screen says "someone else" for null; it must never print
 * a raw id or an email.
 *
 * `fullName?.trim() || email` and not `fullName ?? email`: a nameless login has
 * `full_name = ''`, which `??` passes straight through, and the screen then
 * shows nothing at all rather than a name. That exact bug shipped once
 * (ADR-221) and is still live in `resolveIssuedTo`.
 *
 * `shortName` so the notice reads "Mehul" rather than a four-part legal name
 * inside a one-line toast — the same treatment Issued To and Assembled By give
 * a person's name when it is stored for display.
 */
export async function rowChangedByName(
  tx: DbTransaction,
  updatedBy: string | null | undefined,
): Promise<string | null> {
  if (!updatedBy) return null;
  const rows = await tx
    .select({ fullName: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, updatedBy))
    .limit(1);
  const u = rows[0];
  if (!u) return null;
  const name = u.fullName?.trim() || u.email;
  return name ? shortName(name) : null;
}
