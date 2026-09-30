// Master Rules Mode on the server (plan v3 Step 2, migration 0183).
//
// The rules themselves live in @innovic/shared (lib/master-rules.ts,
// lib/gst.ts) so the form, the API and the importers agree. This file only
// decides what a broken rule DOES, from the company setting:
//   warn    (default) → the record saves; the problems come back as `warnings`
//   enforce           → 400 validation_error with field errors, nothing saved
//
// The 400 carries the same `details` shape as a Zod failure
// ({ formErrors, fieldErrors }), so the web maps it under the fields the same way.

import { eq } from 'drizzle-orm';
import type { ZodError } from 'zod';
import {
  MASTER_RULE_SETTINGS_DEFAULT,
  type MasterRuleIssue,
  type MasterRuleSettings,
  type MasterRulesMode,
} from '@innovic/shared';
import { companies } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';

/** The company's rule settings. A missing row (should not happen) falls back
 *  to the defaults: warn, Check HSN off, 6 digits. */
export async function loadMasterRuleSettings(
  tx: DbTransaction,
  companyId: string,
): Promise<MasterRuleSettings> {
  const rows = await tx
    .select({
      masterRulesMode: companies.masterRulesMode,
      checkHsn: companies.checkHsn,
      hsnMinDigits: companies.hsnMinDigits,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const r = rows[0];
  if (!r) return MASTER_RULE_SETTINGS_DEFAULT;
  return {
    masterRulesMode: r.masterRulesMode === 'enforce' ? 'enforce' : 'warn',
    checkHsn: r.checkHsn,
    hsnMinDigits: r.hsnMinDigits,
  };
}

/** Enforce mode: refuse with field errors. Warn mode: hand the problems back
 *  for the response. `what` names the record in the refusal message. */
export function applyMasterRules(
  issues: readonly MasterRuleIssue[],
  mode: MasterRulesMode,
  what: string,
): MasterRuleIssue[] {
  if (issues.length === 0) return [];
  if (mode === 'enforce') {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of issues) (fieldErrors[i.field] ??= []).push(i.message);
    throw new ValidationError(`${what}: ${issues.map((i) => i.message).join(' ')}`, {
      formErrors: [],
      fieldErrors,
    });
  }
  return [...issues];
}

/** Response extra: `{ warnings }` only when there are any. */
export function withWarnings<T extends object>(
  row: T,
  warnings: readonly MasterRuleIssue[],
): T & { warnings?: MasterRuleIssue[] } {
  return warnings.length > 0 ? { ...row, warnings: [...warnings] } : row;
}

// ── Excel import helpers (ERPNext Data Import behaviour) ────────────────────

/** Update Existing: a blank cell means "keep the current value", so drop
 *  undefined / null / '' keys before the row is parsed. */
export function dropBlankCells(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

/** The row's name for the result table, whatever shape the row arrived in. */
export function rawRowText(raw: unknown, key: string): string {
  if (typeof raw !== 'object' || raw === null) return '';
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** A Zod failure on ONE import row, in the user's words: "Email: Invalid
 *  email; Pincode is too long (max 12 characters)". */
export function zodRowReason(error: ZodError, labels: Readonly<Record<string, string>>): string {
  return error.issues
    .map((iss) => {
      const key = String(iss.path[0] ?? '');
      const label = labels[key] ?? key;
      if (iss.code === 'too_big') return `${label} is too long (max ${String(iss.maximum)})`;
      return label ? `${label}: ${iss.message}` : iss.message;
    })
    .join('; ');
}

/** "Customer" + issues → one skip reason / warning line per issue. */
export function issueTexts(issues: readonly MasterRuleIssue[]): string[] {
  return issues.map((i) => i.message);
}
