// useFormDraft — a half-typed form survives a tab switch (ADR-313, owner 2026-11-23).
//
// A tab-bar click unmounts the form. Without this, everything typed is gone.
// With it, the form's values are copied to sessionStorage as the user types,
// and put back the next time the same form opens for the same record.
//
// RULES (owner-approved plan, 2026-11-23):
//   - A draft is NEVER saved by itself. It only refills the boxes; the user
//     still presses Save, and Save goes through useSaveKey (ADR-172) as always.
//   - A draft carries the record's `updatedAt` as it was loaded. If the record
//     was saved by anyone since, the draft is NOT put back (§20.4: putting old
//     values over a newer record and saving would wipe the other person's
//     change without a 409). The user is told.
//   - Kept per browser tab (sessionStorage) and per person (user id in the key);
//     every draft is also removed at sign-out (lib/session.ts).
//   - Removed on Save, on Cancel / Exit (lib/exit-guard.tsx calls `clear`), and
//     when the user presses "Discard changes".
//   - Files (File / Blob) cannot be stored: they come back empty and the band
//     says so.
//
// Usage:
//   const draft = useFormDraft({
//     key: id ? `so-edit:${id}` : 'so-new',   // form + record
//     ready: !!so,                             // form holds its starting values
//     values: { header, lines },               // JSON-able snapshot
//     apply: (v) => { setHeader(v.header); setLines(v.lines); },
//     version: so?.updatedAt,                  // edit forms; omit for new
//   });
//   const exit = useExitConfirm({ onExit, draft });
//   ... {draft.band} at the top of the form.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '@/ui/feedback';
import { clickIsAnEdit } from './exit-guard';
import { useSession } from './session';

export const FORM_DRAFT_PREFIX = 'innovic.draft:';
/** After putting a draft back, ignore value changes this long: the form's
 *  setters land a render later, and the first snapshot must not wipe the draft. */
const SETTLE_MS = 600;

interface StoredDraft {
  v: 1;
  version: string | null;
  savedAt: number;
  hadFiles: boolean;
  values: unknown;
}

export interface FormDraftOptions<V> {
  /** Form + record, e.g. `po-edit:${id}` or `po-new`. null = drafts off. */
  key: string | null;
  /** True once the form holds its starting values (record loaded and seeded). */
  ready: boolean;
  /** The form's current values. Must be JSON-able (File/Blob become null). */
  values: V;
  /** Put values back into the form. */
  apply: (values: V) => void;
  /** The record's updatedAt as loaded (edit forms). Omit / null for a new record. */
  version?: string | null | undefined;
}

export interface FormDraft {
  /** Render once at the top of the form. Nothing when there is nothing to say. */
  band: React.ReactNode;
  /** Forget the draft (Save / Cancel / Exit). Safe to call any time. */
  clear: () => void;
  /** Is a draft really stored right now? The exit guard lets a tab switch
   *  through quietly ONLY then, and treats a brought-back draft as unsaved
   *  work (asks on the other ways out, browser prompt on close). */
  hasDraft: () => boolean;
}

/** JSON text of the values, File/Blob dropped. `files` reports whether any were. */
function snapshot(values: unknown): { json: string; files: boolean } {
  let files = false;
  const json = JSON.stringify(values, (_k, v: unknown) => {
    if (typeof Blob !== 'undefined' && v instanceof Blob) {
      files = true;
      return null;
    }
    return v;
  });
  return { json: json ?? 'null', files };
}

function readDraft(storageKey: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredDraft>;
    return d && d.v === 1 && 'values' in d ? (d as StoredDraft) : null;
  } catch {
    return null;
  }
}

function removeDraft(storageKey: string | null): void {
  if (!storageKey) return;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* storage blocked */
  }
}

type Notice = { kind: 'restored'; hadFiles: boolean } | { kind: 'stale' } | null;

export function useFormDraft<V>(opts: FormDraftOptions<V>): FormDraft {
  const { data: me } = useSession();
  const userId = me?.id ?? null;
  const storageKey = opts.key && userId ? `${FORM_DRAFT_PREFIX}${userId}:${opts.key}` : null;
  const version = opts.version ?? null;
  const { json } = snapshot(opts.values);

  const [notice, setNotice] = useState<Notice>(null);
  // Per storage key: the values the form STARTED with (compare to know whether
  // anything was changed), and whether the saved draft has been looked at yet.
  const baseline = useRef<{ key: string; json: string } | null>(null);
  const settleUntil = useRef(0);
  const applyRef = useRef(opts.apply);
  applyRef.current = opts.apply;
  // Only a change the USER made is worth keeping. A form that fills its own
  // defaults after mounting (today's date, a picked-up default) fires no input
  // event, so an untouched form never leaves a draft behind.
  // Same idea of "an edit" as the exit guard: typing, a list pick, or a click on
  // a form control (add line, tick) — never a click on blank page or the menu.
  const touched = useRef(false);
  useEffect(() => {
    if (!storageKey) return;
    const onEdit = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest('nav')) return; // top menu search
      touched.current = true;
    };
    const onPick = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest('[role="option"]'))
        touched.current = true;
    };
    const onClick = (e: Event): void => {
      if (clickIsAnEdit(e.target)) touched.current = true;
    };
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    document.addEventListener('mousedown', onPick, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onEdit, true);
      document.removeEventListener('mousedown', onPick, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [storageKey]);
  // The version as it was when the form OPENED (§20.4). A live update can bring
  // a newer record while the user types; stamping the draft with that newer
  // version would let old typing come back over it and save with no 409.
  // null = take the current one at the next write (after a Save that stayed).
  const frozenVersion = useRef<{ key: string; version: string | null } | null>(null);

  // 1) First time the form is ready for this key: take the baseline, then put
  //    the draft back (same version) or drop it (record changed since).
  useEffect(() => {
    if (!storageKey || !opts.ready) return;
    if (baseline.current?.key === storageKey) return;
    baseline.current = { key: storageKey, json };
    frozenVersion.current = { key: storageKey, version };
    touched.current = false;
    const d = readDraft(storageKey);
    if (!d) {
      setNotice(null);
      return;
    }
    if ((d.version ?? null) !== version) {
      removeDraft(storageKey);
      setNotice({ kind: 'stale' });
      return;
    }
    settleUntil.current = Date.now() + SETTLE_MS;
    touched.current = true;
    applyRef.current(d.values as V);
    setNotice({ kind: 'restored', hadFiles: d.hadFiles });
    // json / version are read at this moment on purpose; the effect must run
    // only when the form becomes ready for a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, opts.ready]);

  // 2) Every change after that: keep a copy, or none when back to the start.
  useEffect(() => {
    if (!storageKey || baseline.current?.key !== storageKey) return;
    if (Date.now() < settleUntil.current) return;
    if (!touched.current) {
      // Not the user: the form filling itself (a default, a seed, a reset after
      // Save & New). That is the new starting point, never "unsaved changes".
      baseline.current = { key: storageKey, json };
      return;
    }
    if (frozenVersion.current?.key !== storageKey) {
      frozenVersion.current = { key: storageKey, version };
    }
    if (json === baseline.current.json) {
      removeDraft(storageKey);
      return;
    }
    const { files } = snapshot(opts.values);
    const d: StoredDraft = {
      v: 1,
      version: frozenVersion.current?.version ?? version,
      savedAt: Date.now(),
      hadFiles: files,
      values: JSON.parse(json) as unknown,
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(d));
    } catch {
      /* storage full / blocked: the form simply has no draft */
    }
    // opts.values is represented by json.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, json, version]);

  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;
  const jsonRef = useRef(json);
  jsonRef.current = json;

  const clear = useCallback(() => {
    removeDraft(keyRef.current);
    // What is on screen now is the new starting point: an unmount right after
    // Save / Cancel must not write the draft again.
    if (keyRef.current) baseline.current = { key: keyRef.current, json: jsonRef.current };
    // A reset that follows (Save & New) is the form's doing, not the user's.
    touched.current = false;
    // After a Save that stays on the page the record has a new version: take it
    // at the next write.
    frozenVersion.current = null;
    settleUntil.current = 0;
    setNotice(null);
  }, []);

  const hasDraft = useCallback((): boolean => {
    const k = keyRef.current;
    if (!k) return false;
    try {
      return sessionStorage.getItem(k) !== null;
    } catch {
      return false;
    }
  }, []);

  const discard = useCallback(() => {
    const start = baseline.current;
    removeDraft(keyRef.current);
    setNotice(null);
    if (start) {
      settleUntil.current = Date.now() + SETTLE_MS;
      applyRef.current(JSON.parse(start.json) as V);
    }
  }, []);

  let band: React.ReactNode = null;
  if (notice?.kind === 'restored') {
    band = (
      <Banner
        tone="info"
        title="Your unsaved changes were brought back"
        onDismiss={() => setNotice(null)}
      >
        {notice.hadFiles ? 'Attached files need to be chosen again. ' : ''}
        Nothing is saved until you press Save.{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={discard}>
          Discard changes
        </button>
      </Banner>
    );
  } else if (notice?.kind === 'stale') {
    band = (
      <Banner
        tone="warn"
        title="Your unsaved changes were not brought back"
        onDismiss={() => setNotice(null)}
      >
        This record was saved by someone after you started, so the form shows the latest saved
        version.
      </Banner>
    );
  }

  return { band, clear, hasDraft };
}

// ── Wiring helpers: one copy for every screen (§21.4) ───────────────────────

/** A form whose values live in a CHILD component that calls useFormDraft
 *  itself: the page hands the exit guard this stand-in, and the child puts its
 *  real draft into `sink` with useDraftSinkFill. */
export function useDraftSink(): { sink: { current: FormDraft | null }; draft: FormDraft } {
  const sink = useRef<FormDraft | null>(null);
  const draft = useMemo<FormDraft>(
    () => ({
      band: null,
      clear: () => sink.current?.clear(),
      hasDraft: () => sink.current?.hasDraft() ?? false,
    }),
    [],
  );
  return { sink, draft };
}

/** Child side of useDraftSink. */
export function useDraftSinkFill(
  sink: { current: FormDraft | null } | null | undefined,
  draft: FormDraft,
): void {
  useEffect(() => {
    if (sink) sink.current = draft;
  });
}

/** The opposite split: the PAGE holds the draft, the child form reports its
 *  values through `onValues` and registers how to put them back with `bind`. */
export interface FormDraftLink {
  onValues: (values: unknown) => void;
  bind: (apply: (values: unknown) => void) => void;
}

/** Page side of FormDraftLink. Ready once the child has reported its values. */
export function usePageDraft(opts: { key: string | null; version?: string | null | undefined }): {
  draft: FormDraft;
  link: FormDraftLink;
} {
  const [values, setValues] = useState<unknown>(null);
  const applyRef = useRef<(v: unknown) => void>(() => undefined);
  const link = useMemo<FormDraftLink>(
    () => ({
      onValues: setValues,
      bind: (apply) => {
        applyRef.current = apply;
      },
    }),
    [],
  );
  const draft = useFormDraft({
    key: opts.key,
    ready: values !== null,
    values,
    apply: (v) => applyRef.current(v),
    version: opts.version,
  });
  return { draft, link };
}

/** Child side of FormDraftLink: reports `values` on every change and registers
 *  `apply`. `link` undefined = this form keeps no draft. */
export function useFormDraftLink(
  link: FormDraftLink | undefined,
  values: unknown,
  apply: (values: unknown) => void,
): void {
  const json = JSON.stringify(values) ?? 'null';
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    link?.bind((v) => applyRef.current(v));
  }, [link]);
  useEffect(() => {
    link?.onValues(JSON.parse(json) as unknown);
  }, [link, json]);
}
