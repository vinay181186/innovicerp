// Master rules on the screen (plan v3 Step 2) — ONE helper the Customer,
// Vendor and Item forms share, so the three show a GSTIN / State / GST
// Category / HSN problem the same way:
//
//   Warn mode    → an amber note under the field; Save stays enabled.
//   Enforce mode → the same note in red; the server refuses the save with a
//                  400 whose fieldErrors land under the same fields.
//
// The checks themselves are the shared ones (checkPartyGst / checkItemHsn in
// @innovic/shared), the same functions the API and the Excel import run, so
// the screen and the server never disagree. Nothing here blocks a submit —
// the server decides.

import {
  GST_CATEGORIES,
  GST_CATEGORY_LABEL,
  INDIAN_STATES,
  MASTER_RULE_SETTINGS_DEFAULT,
  type MasterRuleIssue,
  type MasterRuleSettings,
  checkItemHsn,
  checkPartyGst,
  gstinProblem,
  normalizeGstin,
  resolveStateCode,
} from '@innovic/shared';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { useMyCompany } from './api';

/** Server field errors from an enforce-mode 400, keyed by form field name. */
export type ServerFieldErrors = Record<string, string[]>;

/** What goes under one field: a red `error` (enforce mode / server refusal)
 *  or an amber `warning` (warn mode). At most one of the two is set. */
export interface RuleNote {
  error?: string | undefined;
  warning?: string | undefined;
}

/** The company's master-rule settings; the safe default (Warn, Check HSN off,
 *  6 digits) while /companies/me is still loading or failed. */
export function useMasterRuleSettings(): MasterRuleSettings {
  const { data } = useMyCompany();
  if (!data) return MASTER_RULE_SETTINGS_DEFAULT;
  return {
    masterRulesMode: data.masterRulesMode ?? MASTER_RULE_SETTINGS_DEFAULT.masterRulesMode,
    checkHsn: data.checkHsn ?? MASTER_RULE_SETTINGS_DEFAULT.checkHsn,
    hsnMinDigits: data.hsnMinDigits ?? MASTER_RULE_SETTINGS_DEFAULT.hsnMinDigits,
  };
}

/** Pull `details.fieldErrors` out of a validation_error 400, or null. */
export function serverFieldErrorsOf(err: unknown): ServerFieldErrors | null {
  if (!(err instanceof ApiError) || err.code !== 'validation_error') return null;
  const d = err.details as { fieldErrors?: Record<string, unknown> } | null | undefined;
  if (!d || typeof d !== 'object' || !d.fieldErrors) return null;
  const out: ServerFieldErrors = {};
  for (const [field, msgs] of Object.entries(d.fieldErrors)) {
    if (Array.isArray(msgs)) {
      const list = msgs.filter((m): m is string => typeof m === 'string' && m !== '');
      if (list.length > 0) out[field] = list;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** One field's note: a server refusal wins, then the live rule problem — red in
 *  enforce mode, amber in warn mode. */
function noteFor(
  field: string,
  issues: readonly MasterRuleIssue[],
  enforce: boolean,
  server: ServerFieldErrors | null | undefined,
): RuleNote {
  const fromServer = server?.[field];
  if (fromServer && fromServer.length > 0) return { error: fromServer.join(' ') };
  const msg = issues
    .filter((i) => i.field === field)
    .map((i) => i.message)
    .join(' ');
  if (!msg) return {};
  return enforce ? { error: msg } : { warning: msg };
}

/** The amber warning line, same size and place as `.form-help`. */
export function RuleWarning(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-help" style={{ color: 'var(--amber2)' }}>
      {props.children}
    </div>
  );
}

/** For <FormField help>: the amber warning in place of the quiet help, else
 *  the field's usual help. (FormField shows `error` itself, in red.) */
export function ruleHelp(note: RuleNote, fallback?: React.ReactNode): React.ReactNode {
  return note.warning ? <span style={{ color: 'var(--amber2)' }}>{note.warning}</span> : fallback;
}

/** An old record's free-text State that matches no list entry: shown under
 *  the pick-list until a State is chosen. */
export function oldStateHint(oldState: string | null | undefined): string | null {
  return oldState ? `Was: "${oldState}" — choose from the list.` : null;
}

/** The State Code an edit form opens with: the stored code, else the old
 *  free-text State if it names exactly one list entry, else blank. */
export function initialStateCode(
  stateCode: string | null | undefined,
  state: string | null | undefined,
): string | null {
  return stateCode ?? resolveStateCode(state) ?? null;
}

/** The old free-text State when it maps to no list entry (for oldStateHint). */
export function unmappedOldState(
  stateCode: string | null | undefined,
  state: string | null | undefined,
): string | null {
  if (stateCode || !state?.trim()) return null;
  return resolveStateCode(state) ? null : state.trim();
}

/** The red or amber line for a raw `.form-grp` (forms not on <FormField>). */
export function RuleNoteLine(props: { note: RuleNote }): React.JSX.Element | null {
  if (props.note.error) return <div className="form-error">{props.note.error}</div>;
  if (props.note.warning) return <RuleWarning>{props.note.warning}</RuleWarning>;
  return null;
}

/** State pick-list: "Gujarat (24)", value = the 2-digit State Code. */
export const STATE_OPTIONS = INDIAN_STATES.map((s) => ({
  value: s.code,
  label: `${s.name} (${s.code})`,
}));

/** GST Category pick-list. */
export const GST_CATEGORY_OPTIONS = GST_CATEGORIES.map((c) => ({
  value: c,
  label: GST_CATEGORY_LABEL[c],
}));

/** Select value → form value: '' → null. */
export function blankToNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export interface PartyGstNotes {
  gstNumber: RuleNote;
  gstCategory: RuleNote;
  stateCode: RuleNote;
}

/**
 * Customer / Vendor: the live GST notes plus the State auto-fill. When a valid
 * GSTIN is typed and no State is chosen, the State is set from the GSTIN's
 * first two digits (India Compliance does the same on the server).
 *
 * `show` is false on an untouched new form, so a blank page does not open
 * covered in amber; server errors show regardless.
 */
export function usePartyGstNotes(input: {
  gstNumber: string | null | undefined;
  gstCategory: string | null | undefined;
  stateCode: string | null | undefined;
  setStateCode: (code: string) => void;
  show: boolean;
  serverFieldErrors?: ServerFieldErrors | null | undefined;
}): PartyGstNotes {
  const settings = useMasterRuleSettings();
  const enforce = settings.masterRulesMode === 'enforce';
  const { gstNumber, gstCategory, stateCode, setStateCode } = input;

  useEffect(() => {
    const g = normalizeGstin(gstNumber);
    if (!g || stateCode) return;
    if (gstinProblem(g) === null) setStateCode(g.slice(0, 2));
  }, [gstNumber, stateCode, setStateCode]);

  const issues = input.show
    ? checkPartyGst({
        gstNumber: gstNumber ?? null,
        gstCategory: gstCategory || null,
        stateCode: stateCode || null,
        // The old free-text State is shown as its own hint, not re-checked.
        state: null,
      }).issues
    : [];
  return {
    gstNumber: noteFor('gstNumber', issues, enforce, input.serverFieldErrors),
    gstCategory: noteFor('gstCategory', issues, enforce, input.serverFieldErrors),
    stateCode: noteFor('stateCode', issues, enforce, input.serverFieldErrors),
  };
}

/** Item: the live HSN Code note (Check HSN / HSN Min Digits from the company). */
export function useItemHsnNote(input: {
  itemType: string | null | undefined;
  hsnCode: string | null | undefined;
  serverFieldErrors?: ServerFieldErrors | null | undefined;
}): RuleNote {
  const settings = useMasterRuleSettings();
  const enforce = settings.masterRulesMode === 'enforce';
  const issues = checkItemHsn({ itemType: input.itemType, hsnCode: input.hsnCode }, settings);
  return noteFor('hsnCode', issues, enforce, input.serverFieldErrors);
}
