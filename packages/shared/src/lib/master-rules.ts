// Master data rules — Customer / Vendor GST rules and the Item HSN rule, in
// ONE place (plan v3 Step 2). Used by:
//   - the web forms  → amber warnings under the field, the save still goes;
//   - the API        → `warnings` in the response (warn mode) or a 400 with
//                      field errors (enforce mode);
//   - the importers  → the same problems per row.
//
// Master Rules Mode (company setting, migration 0183):
//   'warn'    (default) — problems are shown, the record saves anyway. The
//                         owner fills the data first (Phase E).
//   'enforce'           — a record with a problem is refused. Switched on by
//                         the owner after the data fill (Phase F).

import { ITEM_TYPE_RULES, type ItemType } from '../enums/item-type';
import {
  GST_CATEGORIES_WITHOUT_GSTIN,
  GST_CATEGORY_LABEL,
  type GstCategory,
  gstinProblem,
  hsnProblem,
  normalizeGstin,
  resolveStateCode,
  stateNameForCode,
} from './gst';

export const MASTER_RULES_MODES = ['warn', 'enforce'] as const;
export type MasterRulesMode = (typeof MASTER_RULES_MODES)[number];
export const MASTER_RULES_MODE_LABEL: Record<MasterRulesMode, string> = {
  warn: 'Warn (save anyway)',
  enforce: 'Enforce (refuse to save)',
};

/** One broken master rule. `field` is the form / API field name, so a form can
 *  put the message under the right box and an enforce-mode 400 can carry it as
 *  a field error. */
export interface MasterRuleIssue {
  field: string;
  message: string;
}

/** The company settings the rules read (companies table, migration 0183). */
export interface MasterRuleSettings {
  masterRulesMode: MasterRulesMode;
  checkHsn: boolean;
  hsnMinDigits: number;
}

export const MASTER_RULE_SETTINGS_DEFAULT: MasterRuleSettings = {
  masterRulesMode: 'warn',
  checkHsn: false,
  hsnMinDigits: 6,
};

// ── Customer / Vendor ────────────────────────────────────────────────────────

export interface PartyGstInput {
  gstCategory?: string | null | undefined;
  gstNumber?: string | null | undefined;
  /** Free-text State (old rows, import cells). */
  state?: string | null | undefined;
  /** State Code from the pick-list — wins over `state` when given. */
  stateCode?: string | null | undefined;
}

export interface PartyGstResult {
  /** What to store: GSTIN tidied, State Code resolved (or taken from the
   *  GSTIN when the State was blank), State = the list's name for that code. */
  values: { gstNumber: string | null; stateCode: string | null; state: string | null };
  issues: MasterRuleIssue[];
}

/**
 * The India Compliance party rule (validate_gstin + validate_gst_category):
 *   - GSTIN: 15 characters, the pattern, the check digit;
 *   - GSTIN required unless the GST Category is Unregistered / Overseas, and an
 *     Unregistered party must NOT carry a GSTIN;
 *   - the first 2 GSTIN digits are the State Code — a blank State is filled
 *     from the GSTIN, a different State is a problem;
 *   - GST Category and State must be chosen (State is the invoice's Place of
 *     Supply, plan D2) — except an Overseas party needs no Indian State.
 */
export function checkPartyGst(input: PartyGstInput): PartyGstResult {
  const issues: MasterRuleIssue[] = [];
  const gstNumber = normalizeGstin(input.gstNumber);
  const category = (input.gstCategory ?? null) as GstCategory | null;

  // State: pick-list code first, else the free text resolved against the list.
  let stateCode: string | null = null;
  let state: string | null = (input.state ?? '').trim() || null;
  const typedCode = (input.stateCode ?? '').trim();
  if (typedCode) {
    if (stateNameForCode(typedCode)) stateCode = typedCode;
    else
      issues.push({ field: 'stateCode', message: `State Code "${typedCode}" is not in the list.` });
  } else if (state) {
    stateCode = resolveStateCode(state);
    if (!stateCode) {
      issues.push({
        field: 'stateCode',
        message: `State "${state}" is not in the list of Indian States — choose it from the list.`,
      });
    }
  }

  if (gstNumber) {
    const problem = gstinProblem(gstNumber);
    if (problem) {
      issues.push({ field: 'gstNumber', message: problem });
    } else {
      const fromGstin = gstNumber.slice(0, 2);
      if (!stateCode) {
        // Auto-fill the State from the GSTIN (India Compliance does the same).
        // An unmapped State text is replaced — the GSTIN is the stronger fact.
        stateCode = fromGstin;
        const i = issues.findIndex((x) => x.field === 'stateCode');
        if (i >= 0) issues.splice(i, 1);
      } else if (stateCode !== fromGstin) {
        issues.push({
          field: 'stateCode',
          message: `GSTIN starts with ${fromGstin} (${stateNameForCode(fromGstin) ?? '?'}) but State is ${stateNameForCode(stateCode)} (${stateCode}).`,
        });
      }
    }
  }
  if (stateCode) state = stateNameForCode(stateCode);

  if (!category) {
    issues.push({ field: 'gstCategory', message: 'Choose the GST Category.' });
  } else if (!(GST_CATEGORY_LABEL as Record<string, string>)[category]) {
    issues.push({
      field: 'gstCategory',
      message: `GST Category "${category}" is not in the list.`,
    });
  } else if (!gstNumber && !GST_CATEGORIES_WITHOUT_GSTIN.includes(category)) {
    issues.push({
      field: 'gstNumber',
      message: `GSTIN is required for GST Category ${GST_CATEGORY_LABEL[category]}.`,
    });
  } else if (gstNumber && category === 'unregistered') {
    issues.push({
      field: 'gstCategory',
      message: 'A party with a GSTIN cannot be Unregistered — choose the right GST Category.',
    });
  }

  if (!stateCode && category !== 'overseas' && !issues.some((x) => x.field === 'stateCode')) {
    issues.push({ field: 'stateCode', message: 'Choose the State.' });
  }

  return { values: { gstNumber, stateCode, state }, issues };
}

// ── Item HSN (D3) ────────────────────────────────────────────────────────────

/** Item types whose HSN Code the "Check HSN" setting requires — the types we
 *  SELL (ITEM_TYPE_RULES[t].sold: Component and Assembly). Raw material,
 *  consumables, tools and customer-supplied material are bought or received,
 *  never invoiced, so their HSN is optional. */
export function isHsnCheckedItemType(itemType: string | null | undefined): boolean {
  if (!itemType) return false;
  return (
    (ITEM_TYPE_RULES as Record<string, { sold: boolean } | undefined>)[itemType]?.sold === true
  );
}

/**
 * The HSN rule for ONE item:
 *   - a typed HSN Code must be digits, 4 / 6 / 8 long, and at least HSN Min
 *     Digits long (always checked when present);
 *   - with Check HSN on, a SOLD item (isHsnCheckedItemType) must have one.
 */
export function checkItemHsn(
  input: { itemType?: ItemType | string | null | undefined; hsnCode?: string | null | undefined },
  settings: Pick<MasterRuleSettings, 'checkHsn' | 'hsnMinDigits'>,
): MasterRuleIssue[] {
  const hsn = (input.hsnCode ?? '').trim();
  if (hsn) {
    const p = hsnProblem(hsn, settings.checkHsn ? settings.hsnMinDigits : 4);
    return p ? [{ field: 'hsnCode', message: p }] : [];
  }
  if (settings.checkHsn && isHsnCheckedItemType(input.itemType)) {
    return [
      { field: 'hsnCode', message: 'HSN Code is required for an item we sell (Check HSN is on).' },
    ];
  }
  return [];
}

/** Response extra carried by a Customer / Vendor / Item save: the rules the
 *  record breaks, in warn mode (enforce mode refuses instead). */
export interface MasterRuleWarnings {
  warnings?: MasterRuleIssue[];
}
