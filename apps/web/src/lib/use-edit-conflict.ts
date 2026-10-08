// ADR-226 / §20.4 — the ONE wiring an edit screen needs so that two people
// editing one document both keep their work.
//
// Every edit screen used to send its WHOLE record on save: all forty fields,
// including the thirty-nine the user never touched. That is what made §20.4's
// bug possible — "you change a line's qty to 60 while Jinal changes its Rev to
// C; your save wipes his Rev and nobody is told."
//
// This hook gives a screen four things, and none of them asks the user to press
// anything:
//
//   opened     the version the record was loaded with, captured once
//   save()     send ONLY changed fields; on a 409 re-read, retry once onto the
//              fresh row, and show the 3-second notice
//   watching   a live subscription, so the notice can appear the MOMENT someone
//              else saves, before this user has typed twenty more lines
//   nothing    no buttons, no "reload" link, no manual refresh
//
// WHY A HOOK AND NOT A PATTERN TO COPY: there are twelve of these screens and
// no shared edit-form abstraction. Twelve hand-rolled versions of "diff, retry,
// notify" would drift the way `listQcUserOptions` and `listProductionUser-
// Options` drifted before ADR-221 collapsed them. One hook, twelve callers.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//   • It never re-seeds the form. That was the Plan-edit bug (ADR-226): keying
//     a form's values on the LIVE record version meant anyone else's save threw
//     away what the user was typing, silently, with no save involved.
//   • It never decides what the other person changed from a Realtime payload.
//     `changedKeys(loaded, fresh)` on the save path is the same rule the server
//     uses; a column list off a socket message would be a second, divergent
//     answer to one question. The subscription is a doorbell, not a diff.

import { changedFields } from '@innovic/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useToast } from '@/ui/feedback';
import { type MergeOutcome, saveWithMerge } from './save-with-merge';
import { useOpenedVersion, type OpenedVersion } from './use-opened-version';
import { useRecordWatch } from './use-record-watch';

export interface UseEditConflictOptions<TRecord extends object> {
  /** The Postgres table, for the live watch — e.g. `'nc_register'`. Must be in
   *  the `supabase_realtime` publication (migration 0202). */
  table: string;
  /** The record's id. Undefined while loading. */
  id: string | undefined;
  /** The record as loaded. The hook captures its version on first sight. */
  record: TRecord | undefined;
  /** Re-read the record from the server, bypassing the cache. Only called after
   *  a conflict. Build it with `queryClient.fetchQuery({ ..., staleTime: 0 })`. */
  refetch: () => Promise<TRecord>;
  /**
   * The fields THIS SCREEN can edit. Drives both the diff and clash detection.
   *
   * Required, and not inferred: without it a field changed by a cascade the
   * user cannot even see would be reported as "theirs", and a field the screen
   * shows read-only would be sent as an edit. Name only what the form's inputs
   * actually write.
   */
  editableKeys: readonly (keyof TRecord & string)[];
  /** Field key → the screen's own label for it, per docs/NAMING.md. Used in the
   *  notice, so the user reads "Received Qty", never `receivedQty`. */
  label: (field: string) => string;
  /** The document as the user says it — "GRN", "Job Card", "this machine". */
  noun: string;
}

export interface EditConflictApi {
  /** Pass `opened.expected()` as `expectedUpdatedAt`; call `opened.saved(...)`
   *  after your own successful save if the screen stays open. */
  opened: OpenedVersion;
  /**
   * Save, merging if someone else got there first.
   *
   * `current` is what the form holds — the full set of values; the hook reduces
   * it to just the changed fields before sending. `attempt` performs the actual
   * mutation with the narrow payload and the version token it is handed.
   *
   * Returns the save's result, or `null` when there was nothing to save (the
   * user is told; nothing is written). Errors other than a resolved conflict
   * are rethrown so the screen's existing error banner still works.
   */
  /** Generic in the FORM's own value type, inferred per call. The record a
   *  screen loads and the payload it sends are different shapes — an NC's
   *  stored `reason` is `string | null`, its input's is `string | undefined` —
   *  and tying them to one parameter made every caller fight the compiler
   *  instead of describing what it meant. The field list is checked against
   *  the RECORD, which is the well-typed side. */
  save: <TInput extends object, R>(
    current: TInput,
    attempt: (payload: Partial<TInput>, expectedUpdatedAt: string | undefined) => Promise<R>,
  ) => Promise<R | null>;
  /** True once someone else has saved this record since the screen opened.
   *  A screen may show it inline; the notice is raised automatically. */
  changedByOther: boolean;
}

/** "Received Qty and Rate" — the field list as a person would say it. */
function joinLabels(fields: readonly string[], label: (f: string) => string): string {
  const names = fields.map(label);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A value as it should read inside a one-line notice. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

export function useEditConflict<TRecord extends object>(
  opts: UseEditConflictOptions<TRecord>,
): EditConflictApi {
  const { table, id, record, refetch, editableKeys, label, noun } = opts;
  const toast = useToast();
  const opened = useOpenedVersion(
    (record as { updatedAt?: string | null | undefined } | undefined)?.updatedAt,
  );
  const watch = useRecordWatch({ table, id });

  // The live doorbell. Fires only for a change made while this screen is open —
  // including our own save, which `watch.acknowledge()` swallows right after.
  const changedByOther = watch.changedByOther;

  // THE INSTANT WARNING. The owner's requirement (2026-10-08) was: no button,
  // no manual refresh, a notice that shows for 3 seconds and can be closed with
  // the X. This is the half that fires BEFORE the user saves, so they find out
  // now rather than after typing twenty more lines.
  //
  // It is deliberately ANONYMOUS where the save-time notice is named. A socket
  // message could carry `updated_by`, but turning an id into a name would need
  // a lookup this screen does not have, and a second way of answering "who" is
  // how two answers start disagreeing. The doorbell says someone; the receipt,
  // which the server resolves, says Mehul.
  //
  // It says the entry is SAFE because that is the thing a person panics about,
  // and because it is true: nothing is re-seeded, nothing is cleared, and the
  // save that follows merges onto their version.
  const announcedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!changedByOther || !id) return;
    if (announcedFor.current === id) return; // once per record, not per event
    announcedFor.current = id;
    toast.info(`Someone else just changed this ${noun}. Your entry is safe — keep going.`);
  }, [changedByOther, id, noun, toast]);
  useEffect(() => {
    if (!changedByOther) announcedFor.current = null;
  }, [changedByOther]);

  const keys = useMemo(() => editableKeys, [editableKeys]);

  // ADR-226 review — the baseline is the record AS THIS SCREEN LOADED IT, and
  // now it really is. It used to diff against the live `record` prop, and only
  // the VERSION was frozen, while the doc comments claimed otherwise.
  //
  // Safe today only by luck: focus refetching is off app-wide and the doorbell
  // deliberately does not invalidate. But each screen's `refetch` writes into
  // the SAME query key its detail hook reads, so after any 409 the on-screen
  // baseline BECAME the other person's row. Reachable: a save 409s, the retry
  // then fails for a different reason (a second 409, a line-cap 400, the
  // QC-locked-line refusal), the screen stays open with its error banner, the
  // user presses Save again — and now their own untouched values read as THEIR
  // changes and get reverted, under a notice saying their changes were saved.
  //
  // Frozen on the first non-undefined record, like `useOpenedVersion` freezes
  // the version it pairs with. The screen's own save is what resolves it, and
  // every one of these screens navigates away on success.
  const loadedRef = useRef<TRecord | undefined>(undefined);
  if (loadedRef.current === undefined && record !== undefined) loadedRef.current = record;
  const loaded = loadedRef.current;

  const save = useCallback(
    async <TInput extends object, R>(
      current: TInput,
      attempt: (payload: Partial<TInput>, expectedUpdatedAt: string | undefined) => Promise<R>,
    ): Promise<R | null> => {
      if (!loaded) throw new Error('Cannot save before the record has loaded');

      // ONLY what this user changed. Everything else is left out, so the other
      // person's fields are not even mentioned in the request — which is why
      // two people on different fields never collide in the first place.
      const payload = changedFields(loaded as Record<string, unknown>, current, keys);
      const ourKeys = Object.keys(payload);
      if (ourKeys.length === 0) {
        // Nothing to write. This is not a no-op everywhere: a Delivery Challan
        // and a Customer Dispatch bump their own revision and re-post
        // downstream quantities on EVERY save, so an empty save would churn the
        // document for no reason. Telling the user is the honest answer.
        toast.info(`Nothing changed on this ${noun}.`);
        return null;
      }

      const { result, outcome } = await saveWithMerge<TRecord, R>({
        attempt: (expectedUpdatedAt) => attempt(payload, expectedUpdatedAt),
        refetch,
        loaded,
        ourChanges: payload as Record<string, unknown>,
        openedVersion: opened.expected(),
        comparableKeys: keys,
      });

      // Our own save fires the subscription too; clear the doorbell so a
      // self-inflicted event never shows a notice.
      watch.acknowledge();
      announce(outcome, { toast, label, noun });
      return result;
    },
    [loaded, keys, refetch, opened, watch, toast, label, noun],
  );

  return { opened, save, changedByOther };
}

/** The 3-second notice. Three cases, and only two of them say anything. */
function announce(
  outcome: MergeOutcome,
  ctx: {
    toast: ReturnType<typeof useToast>;
    label: (f: string) => string;
    noun: string;
  },
): void {
  const { toast, label, noun } = ctx;
  if (outcome.kind === 'clean') return; // nobody else touched it — say nothing

  const who = outcome.conflict.changedByName ?? 'Someone else';

  if (outcome.kind === 'merged') {
    // They changed different fields from us. Both sets are now stored. The user
    // is told so the figure that moved under them is not a surprise later.
    const theirs = joinLabels(outcome.theirFields, label);
    toast.ok(
      theirs
        ? `${who} also changed ${theirs} on this ${noun}. Your changes are saved.`
        : `${who} also changed this ${noun}. Your changes are saved.`,
    );
    return;
  }

  // Same field, both of us. Ours is what is stored — we saved second, and
  // deliberately. §20.4's complaint is "nobody is told", so this one names the
  // value that was replaced, stays twice as long, and is the orange notice.
  const first = outcome.clashes[0];
  const detail =
    outcome.clashes.length === 1 && first
      ? `${label(first.field)} is ${show(first.ourValue)} — ${who} had put ${show(first.theirValue)}.`
      : `${joinLabels(
          outcome.clashes.map((c) => c.field),
          label,
        )} are yours — ${who}'s values were replaced.`;
  toast.show(`You and ${who} both changed the same thing. ${detail}`, { kind: 'warn' });
}
