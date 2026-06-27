// Document-number override — shared config + check contract.
//
// Single source of truth for the per-type prefix / digit count / strict format,
// consumed by the backend `/doc-numbers/check` endpoint AND the frontend
// useDocNumber hook + DocNumberInput component. Phase 1 covers SO / PO / GRN;
// Phase 2 adds 12 more types by extending DOC_NUMBER_FORMATS only.
//
// NOTE: formats follow the project's real convention (IN-SO / IN-PO / IN-GRN),
// not the SO-##### shape the original spec assumed — confirmed by the existing
// nextSoCode (IN-SO-#####) and live PO/GRN data (IN-PO-00002, IN-GRN-…).

import { z } from 'zod';

export const DOC_NUMBER_TYPES = ['sales_order', 'purchase_order', 'grn'] as const;
export type DocNumberType = (typeof DOC_NUMBER_TYPES)[number];

export interface DocNumberFormat {
  /** Literal prefix, e.g. "IN-SO-". */
  prefix: string;
  /** Exact digit count after the prefix. */
  digits: number;
  /** Human label for the field. */
  label: string;
}

export const DOC_NUMBER_FORMATS: Record<DocNumberType, DocNumberFormat> = {
  sales_order: { prefix: 'IN-SO-', digits: 5, label: 'SO No.' },
  purchase_order: { prefix: 'IN-PO-', digits: 5, label: 'PO No.' },
  grn: { prefix: 'IN-GRN-', digits: 5, label: 'GRN No.' },
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strict `^<prefix>\d{digits}$` pattern for a type (e.g. /^IN-SO-\d{5}$/). */
export function docNumberPattern(type: DocNumberType): RegExp {
  const f = DOC_NUMBER_FORMATS[type];
  return new RegExp(`^${escapeRe(f.prefix)}\\d{${f.digits}}$`);
}

/** Pad a user-typed value to the canonical form: keep the prefix (or add it),
 *  zero-pad the trailing digits to the expected width. Returns the input
 *  unchanged when it can't be confidently normalised. */
export function padDocNumber(type: DocNumberType, value: string): string {
  const f = DOC_NUMBER_FORMATS[type];
  const v = value.trim();
  if (!v) return v;
  // Strip the prefix if present (case-insensitive), else take trailing digits.
  const withoutPrefix = v.toUpperCase().startsWith(f.prefix.toUpperCase())
    ? v.slice(f.prefix.length)
    : v;
  const digitsOnly = withoutPrefix.replace(/\D/g, '');
  if (!digitsOnly) return v;
  return `${f.prefix}${digitsOnly.padStart(f.digits, '0')}`;
}

// ── Pure validation logic (shared by the hook; unit-testable without a DOM) ──

export interface DocNumberEval {
  /** Trimmed value is empty → "use the auto-generated number". */
  isEmpty: boolean;
  /** Non-empty value that doesn't match the strict pattern. */
  formatInvalid: boolean;
  /** Whether the backend duplicate check should run (skip for empty/invalid). */
  shouldCheck: boolean;
  /** Canonical, zero-padded form of the value (for blur auto-format). */
  padded: string;
}

export function evaluateDocNumber(type: DocNumberType, value: string): DocNumberEval {
  const isEmpty = value.trim().length === 0;
  const formatInvalid = !isEmpty && !docNumberPattern(type).test(value.trim());
  return { isEmpty, formatInvalid, shouldCheck: !isEmpty && !formatInvalid, padded: padDocNumber(type, value) };
}

/** The inline message to show, or null when the value is fine. Exact wording
 *  per the feature spec. */
export function docNumberError(
  type: DocNumberType,
  opts: { formatInvalid: boolean; duplicate: boolean },
): string | null {
  if (opts.formatInvalid) {
    const f = DOC_NUMBER_FORMATS[type];
    return `Invalid format — expected ${f.prefix}${'N'.repeat(f.digits)}`;
  }
  if (opts.duplicate) return 'Duplicate — this number already exists';
  return null;
}

// ── Endpoint contract ──
export const checkDocNumberQuerySchema = z.object({
  type: z.enum(DOC_NUMBER_TYPES),
  /** Code to check; when omitted, only the suggested next code is returned. */
  code: z.string().trim().max(64).optional(),
});
export type CheckDocNumberQuery = z.infer<typeof checkDocNumberQuerySchema>;

export const checkDocNumberResponseSchema = z.object({
  /** True when an active row with this code already exists for the company. */
  exists: z.boolean(),
  /** Suggested next code (MAX+1 after the highest existing) for the type. */
  nextCode: z.string(),
  /** True when the supplied code matches the strict format (false if no code). */
  formatValid: z.boolean(),
});
export type CheckDocNumberResponse = z.infer<typeof checkDocNumberResponseSchema>;
