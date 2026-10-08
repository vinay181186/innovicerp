// ADR-225 / §20.4 — "an edit sends back what it loaded", and when someone else
// got there first the save MERGES instead of failing at the user.
//
// THE BUG THIS EXISTS FOR, in the words of §20.4: "you change a line's qty to
// 60 while Jinal changes its Rev to C; your save wipes his Rev and nobody is
// told." It happened because a screen sends its WHOLE record on save — all
// forty fields, including the thirty-nine the user never touched. Saving pushed
// a photograph of the document as it looked when the screen opened back over
// whatever had changed since.
//
// The fix has two halves and this file is the second one:
//
//   1. The screen sends ONLY the fields whose value differs from what it loaded
//      (`changedFields` in @innovic/shared). Every service already writes only
//      the keys it was given, so the other person's fields are untouched. This
//      alone fixes the common case — two people, different fields.
//
//   2. `saveWithMerge` below handles the case the server still refuses: the row
//      moved, so the `expectedUpdatedAt` the screen opened with is stale. It
//      re-reads the record, retries the SAME narrow payload against the fresh
//      version ONCE, and reports what happened so the screen can show its
//      3-second notice. The user presses nothing and retypes nothing.
//
// A SAME-FIELD CLASH is the one case nothing can merge, and it is detected
// here, not on the server: the browser holds `loaded` and can read `fresh`, so
// the fields the other person changed are `changedKeys(loaded, fresh)`, and the
// clash is that set intersected with the user's own changed keys. The server
// cannot work this out — it never saw what our screen loaded. The user's value
// wins (they saved second, deliberately) and the notice says so, naming the
// value that was replaced, because §20.4's complaint is "nobody is told".
//
// ONE retry, never a loop: a second 409 means the document is being changed
// faster than we can save, and silently trying again would hide a real fight
// over one record.

import { changedKeys, isEditConflictCode, parseEditConflictDetails } from '@innovic/shared';
import type { EditConflictDetails } from '@innovic/shared';

/** What `saveWithMerge` did, for the screen's notice. */
export type MergeOutcome =
  /** Saved first time. Nobody else had touched the record. Show nothing. */
  | { kind: 'clean' }
  /** Someone else had saved; we re-applied onto their version and succeeded.
   *  `theirFields` are the field keys they changed. Show the plain notice. */
  | { kind: 'merged'; conflict: EditConflictDetails; theirFields: string[] }
  /** As `merged`, but we and they changed the SAME field(s). Ours is what is
   *  stored now. Show the warning notice and name `clashes`. */
  | {
      kind: 'clashed';
      conflict: EditConflictDetails;
      theirFields: string[];
      clashes: { field: string; theirValue: unknown; ourValue: unknown }[];
    };

export interface SaveWithMergeOptions<TRecord extends object, TResult> {
  /**
   * Run the save with this version token. Called once, and at most once more
   * with the fresh token after a conflict. MUST send only the changed fields —
   * build the payload with `changedFields(loaded, current)` before calling.
   */
  attempt: (expectedUpdatedAt: string | undefined) => Promise<TResult>;
  /**
   * Re-read the record from the server, bypassing the cache. Used only after a
   * conflict. Return the fresh record; its `updatedAt` becomes the retry's
   * token.
   */
  refetch: () => Promise<TRecord>;
  /** The record AS THIS SCREEN LOADED IT — the photograph. */
  loaded: TRecord;
  /**
   * What THIS user changed — the narrow payload `attempt` sends, built with
   * `changedFields(loaded, current)`. Its keys drive clash detection and its
   * values let the notice print "yours (58), theirs was (55)".
   */
  ourChanges: Readonly<Record<string, unknown>>;
  /** The version the screen opened with — `opened.expected()`. */
  openedVersion: string | undefined;
  /**
   * Optional: limit clash detection to the fields this screen can edit. Without
   * it, every key of the record is compared, and a field changed by a cascade
   * the user cannot even see would be reported as "theirs". Pass the screen's
   * editable keys.
   */
  comparableKeys?: readonly string[];
}

/** `updatedAt` off a record, whatever its exact type. */
function versionOf(record: object): string | undefined {
  const v = (record as { updatedAt?: unknown }).updatedAt;
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (v instanceof Date) return v.toISOString();
  return undefined;
}

function isConflict(e: unknown): boolean {
  return isEditConflictCode((e as { code?: unknown } | null)?.code);
}

/**
 * Save, and if someone else saved first, re-apply onto their version once.
 *
 * Returns the save's own result plus a `MergeOutcome` describing what the user
 * should be told. Throws only when the save genuinely failed — a second
 * conflict, or any non-conflict error, is rethrown untouched so the screen's
 * existing error banner still works.
 */
export async function saveWithMerge<TRecord extends object, TResult>(
  opts: SaveWithMergeOptions<TRecord, TResult>,
): Promise<{ result: TResult; outcome: MergeOutcome }> {
  try {
    const result = await opts.attempt(opts.openedVersion);
    return { result, outcome: { kind: 'clean' } };
  } catch (e) {
    if (!isConflict(e)) throw e;

    // Name the other person from the refusal. A 409 that does not carry the
    // details (an older API, or a conflict raised somewhere that cannot resolve
    // the name) still merges — the notice just says "someone else".
    const conflict: EditConflictDetails = parseEditConflictDetails(
      (e as { details?: unknown }).details,
    ) ?? { changedByName: null, changedAt: new Date().toISOString() };

    const fresh = await opts.refetch();

    // What THEY changed: the fields that differ between what we loaded and what
    // is stored now. Our own edits are not in `fresh` — our save was refused.
    const theirFields = changedKeys(
      opts.loaded as Record<string, unknown>,
      fresh as Record<string, unknown>,
      opts.comparableKeys,
    );

    // Retry the SAME narrow payload against their version. Because it carries
    // only our changed fields, their fields survive — that is the merge.
    const result = await opts.attempt(versionOf(fresh));

    const clashedFields = theirFields.filter((field) => field in opts.ourChanges);
    if (clashedFields.length === 0) {
      return { result, outcome: { kind: 'merged', conflict, theirFields } };
    }
    const freshValues = fresh as Record<string, unknown>;
    return {
      result,
      outcome: {
        kind: 'clashed',
        conflict,
        theirFields,
        clashes: clashedFields.map((field) => ({
          field,
          theirValue: freshValues[field],
          ourValue: opts.ourChanges[field],
        })),
      },
    };
  }
}
