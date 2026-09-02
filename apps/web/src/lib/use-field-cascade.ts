// useFieldCascade — one CONTROLLER field drives its DEPENDENT fields.
//
// The shape every Innovic form kept re-implementing by hand: pick/type an Item
// Code (or SO / JWSO / Vendor) and the row's Part Name, Material, UOM… refill
// from the master record; blank the code and they reset. Hand-rolled inside an
// `onChange` this goes wrong in four ways, all of which this hook owns instead:
//
//  1. HALF A RESET. The typical handler fills N fields on a match but clears
//     only one of them on a miss — so editing a code that used to match leaves
//     the previously auto-filled NAME sitting under a code it no longer belongs
//     to. Here, whatever a match fills, a miss resets.
//  2. WIPING THE USER'S OWN TYPING. Forms that accept off-master free text (PO
//     lines) let the user type a name for a code the master has never heard of.
//     That name is not ours to clear. A dependent marked `userEditable` is only
//     reset while its value is still EXACTLY what this hook last auto-filled;
//     the moment the user changes it, the field is theirs and we keep our hands
//     off. Fields the user owns outright (Qty, Rate, remarks) are simply never
//     listed as dependents — and `userEntered` below hard-blocks them. A field
//     that is BOTH auto-filled and freely typed (a PO line's Qty/Rate, carried
//     from its PR) takes `keepUserEdits`, which applies the same "is this still
//     ours?" test on the FILL side: swapping PR-1 for PR-2 refreshes what PR-1
//     put there and leaves what the buyer typed alone.
//  3. RACES. Typing "IT-1", "IT-10", "IT-100" starts three lookups; the slowest
//     must not land last and refill the row from a code the user has moved past.
//     Each run takes a request id and an AbortSignal, and a stale reply is
//     dropped rather than applied.
//  4. CLOBBERING SAVED DATA ON EDIT. An edit form arrives already populated from
//     the server, where the stored name may deliberately differ from today's
//     master. The first run therefore only RECORDS the controller value; nothing
//     cascades until the user actually changes it (`runOnMount` opts out).
//
// Deliberately not a data layer: it never fetches on its own. The caller passes
// `resolve`, backed by the module's own list/detail hook — sync (a cached master
// map) or async (a lookup) — so there is exactly one fetch layer per module.

import { useEffect, useRef } from 'react';
import type { FieldValues, Path, PathValue, SetValueConfig, UseFormReturn } from 'react-hook-form';

/** Auto-filled values are dirty (they change what would be saved) and revalidate
 *  (filling a required field must clear its error). Override per call site. */
const DEFAULT_SET_VALUE_OPTIONS: SetValueConfig = { shouldDirty: true, shouldValidate: true };

export interface CascadeFieldOptions {
  /** True when the user may legitimately type into this field themselves. Such a
   *  field is still REPLACED on a fresh match, but on a reset it is only cleared
   *  while it still holds the exact value this hook auto-filled. Default false —
   *  a purely master-derived field (an id) always resets. */
  readonly userEditable?: boolean | undefined;
  /** Extends `userEditable` to the FILL side: on a fresh match the field is
   *  written only while it is still empty, or still holds exactly what this hook
   *  last auto-filled there. Anything else on screen was typed by the user and is
   *  left alone — so swapping the controller (PR-1 → PR-2 on a PO line) refreshes
   *  the auto-filled values without stranding the old ones, yet never silently
   *  replaces a hand-typed one. Default false: fill always replaces, which is what
   *  the Item Code → Name cascades have always done. */
  readonly keepUserEdits?: boolean | undefined;
  /** What counts as "nothing entered yet" for `keepUserEdits`. Defaults to
   *  blank / null / undefined / NaN / the field's own `empty` value. Override
   *  where a field has a second value that is still not the user's own work. */
  readonly isEmpty?: ((value: unknown) => boolean) | undefined;
}

/** One dependent field, type-erased so a single array can hold dependents of
 *  different value types. Build these with `cascadeField`. */
export interface CascadeField<TForm extends FieldValues, TSource> {
  readonly name: string;
  readonly userEditable: boolean;
  readonly keepUserEdits: boolean;
  /** True when the field holds nothing the user could call their own. */
  readonly isEmpty: (value: unknown) => boolean;
  /** Writes the master-derived value and returns what was written. */
  readonly fill: (form: UseFormReturn<TForm>, source: TSource, opts: SetValueConfig) => unknown;
  readonly clear: (form: UseFormReturn<TForm>, opts: SetValueConfig) => void;
  readonly read: (form: UseFormReturn<TForm>) => unknown;
}

/** The default "nothing entered yet" test. `NaN` is in here because a react-hook-form
 *  number input registered with `valueAsNumber` yields NaN once the box is emptied —
 *  an empty box must not read as a value the user typed. */
function defaultIsEmpty(value: unknown, empty: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  return Object.is(value, empty);
}

/**
 * Declare a dependent field: where it lives, how to read it off the source
 * record, and what "empty" means for it.
 *
 * @param name  Form path, e.g. `lines.3.itemName`.
 * @param from  Source record → the value for this field.
 * @param empty What the field resets to when the controller clears or misses.
 */
export function cascadeField<TForm extends FieldValues, TSource, TName extends Path<TForm>>(
  name: TName,
  from: (source: TSource) => PathValue<TForm, TName>,
  empty: PathValue<TForm, TName>,
  options: CascadeFieldOptions = {},
): CascadeField<TForm, TSource> {
  const isEmpty = options.isEmpty ?? ((value: unknown): boolean => defaultIsEmpty(value, empty));
  return {
    name,
    userEditable: options.userEditable ?? false,
    keepUserEdits: options.keepUserEdits ?? false,
    isEmpty,
    fill: (form, source, opts) => {
      const next = from(source);
      form.setValue(name, next, opts);
      return next;
    },
    clear: (form, opts) => {
      form.setValue(name, empty, opts);
    },
    read: (form) => form.getValues(name),
  };
}

export interface FieldCascadeOptions<TForm extends FieldValues, TSource> {
  readonly form: UseFormReturn<TForm>;
  /** The controller's current value. Blank / null / undefined means "cleared",
   *  which resets the dependents without a lookup. */
  readonly value: string | null | undefined;
  /** Look the source record up. Return null for "no such record" — that resets
   *  the dependents. Sync returns are applied immediately; async ones are
   *  dropped if a newer controller value has arrived meanwhile. */
  readonly resolve: (value: string, signal: AbortSignal) => TSource | null | Promise<TSource | null>;
  /** The dependents to refill and reset, from `cascadeField`. */
  readonly fields: readonly CascadeField<TForm, TSource>[];
  /** Belt and braces: paths listed here are never written, whatever `fields`
   *  says. Name the form's user-entered fields (Qty, Rate, remarks…) to make it
   *  impossible for a later edit to quietly start overwriting them. */
  readonly userEntered?: readonly string[] | undefined;
  /** False while the source data is still loading — the hook stays inert rather
   *  than resetting dependents against a master it cannot see yet. */
  readonly enabled?: boolean | undefined;
  /** Cascade on the first run as well. Default false; see note 4 at the top. */
  readonly runOnMount?: boolean | undefined;
  readonly setValueOptions?: SetValueConfig | undefined;
}

export function useFieldCascade<TForm extends FieldValues, TSource>(
  options: FieldCascadeOptions<TForm, TSource>,
): void {
  // The effect must read the CURRENT form/fields/resolve without re-running when
  // their identities change (they are rebuilt every render). Only the controller
  // value is allowed to drive it. Same ref-latch the shared SearchableSelect uses.
  const latest = useRef(options);
  latest.current = options;

  /** Field path → the value THIS hook last auto-filled there. The record of what
   *  is ours to clear; anything else on screen was typed by the user. */
  const owned = useRef(new Map<string, unknown>()).current;
  const seen = useRef<string | null>(null);
  const started = useRef(false);
  const requestId = useRef(0);

  const key = (options.value ?? '').trim();
  const enabled = options.enabled ?? true;
  const runOnMount = options.runOnMount ?? false;

  useEffect(() => {
    if (!enabled) return;

    // First run is a baseline, not a cascade: record what the controller already
    // holds so an edit form's saved dependents survive untouched.
    const first = !started.current;
    started.current = true;
    if (first && !runOnMount) {
      seen.current = key;
      return;
    }
    if (seen.current === key) return;
    seen.current = key;

    const id = ++requestId.current;
    const abort = new AbortController();

    const apply = (source: TSource | null): void => {
      // A newer controller value has already been applied — this reply is stale.
      if (id !== requestId.current) return;
      const { form, fields, userEntered, setValueOptions } = latest.current;
      const blocked = new Set(userEntered ?? []);
      const opts = setValueOptions ?? DEFAULT_SET_VALUE_OPTIONS;
      for (const field of fields) {
        if (blocked.has(field.name)) continue;
        if (source) {
          // `keepUserEdits`: the field is ours to refresh only while it is still
          // empty or still holds exactly what we last put there. A value the user
          // typed over the top is theirs and survives the swap.
          if (field.keepUserEdits) {
            const current = field.read(form);
            const ours = owned.has(field.name) && Object.is(current, owned.get(field.name));
            if (!ours && !field.isEmpty(current)) continue;
          }
          owned.set(field.name, field.fill(form, source, opts));
          continue;
        }
        // No source: reset — unless the user has taken this field over.
        if (field.userEditable && !Object.is(field.read(form), owned.get(field.name))) {
          owned.delete(field.name);
          continue;
        }
        field.clear(form, opts);
        owned.delete(field.name);
      }
    };

    if (key === '') {
      apply(null);
      return;
    }

    const result = latest.current.resolve(key, abort.signal);
    if (!(result instanceof Promise)) {
      apply(result);
      return;
    }
    void result.then(apply, () => {
      // Aborted, or the lookup failed. Leave the dependents exactly as they are:
      // a dropped network request is not evidence that the code is off-master.
    });
    return () => abort.abort();
  }, [key, enabled, runOnMount, owned]);
}
