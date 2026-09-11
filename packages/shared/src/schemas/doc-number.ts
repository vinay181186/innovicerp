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
import { PO_TYPES, type PoType } from '../enums/po-type';

export const DOC_NUMBER_TYPES = [
  'sales_order',
  'job_work_order',
  'purchase_order',
  'grn',
  'delivery_challan',
] as const;
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
  job_work_order: { prefix: 'IN-JW-', digits: 5, label: 'JWSO No.' },
  purchase_order: { prefix: 'IN-PO-', digits: 5, label: 'PO No.' },
  grn: { prefix: 'IN-GRN-', digits: 5, label: 'GRN No.' },
  delivery_challan: { prefix: 'IN-DC-', digits: 5, label: 'DC No.' },
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Purchase-order series ──────────────────────────────────────────────────
//
// A PO's number says WHICH KIND of purchase it is, because the four kinds go
// to different people and get filed differently (user, 2026-09-11):
//
//   standard  (material)  IN-MPO-#####
//   job_work              IN-JWPO-#####
//   service               IN-SPO-#####
//   outsource             IN-OPO-#####
//
// Each series counts on its own, so IN-MPO-00005 and IN-JWPO-00005 can both
// exist — they are different documents and the prefix says so.
export const PO_CODE_PREFIX: Record<PoType, string> = {
  standard: 'IN-MPO-',
  job_work: 'IN-JWPO-',
  outsource: 'IN-OPO-',
  service: 'IN-SPO-',
};

/** The single series every PO used before the split. FROZEN — nothing new is
 *  ever numbered IN-PO-, but every existing row carries it, so it stays an
 *  accepted prefix for validation, padding and the next-number scan. */
export const PO_LEGACY_PREFIX = 'IN-PO-';

/** Every prefix a stored PO code may legitimately start with. Longest first:
 *  callers strip the first match, and 'IN-PO-' must not shadow 'IN-MPO-'. */
export const PO_CODE_PREFIXES: readonly string[] = [
  PO_CODE_PREFIX.job_work,
  PO_CODE_PREFIX.standard,
  PO_CODE_PREFIX.outsource,
  PO_CODE_PREFIX.service,
  PO_LEGACY_PREFIX,
];

/** The prefix a NEW purchase order of this type is numbered with. */
export function poCodePrefix(poType: PoType): string {
  return PO_CODE_PREFIX[poType];
}

// ── Document revisions ─────────────────────────────────────────────────────
//
// A PO or challan carries its revision IN ITS NUMBER: IN-MPO-00005/R1 when it
// is raised, /R2 after the first real change, and so on (user, 2026-09-11).
// The vendor may be holding two printed copies of the same order, and the
// suffix is how they tell which one is current.
//
// A code with NO suffix is revision 1. Every PO and challan raised before this
// existed is bare, and reading it as R1 means the first edit takes it to /R2
// with no migration and no renumbering of history.
const DOC_REVISION_RE = /\/R(\d+)\s*$/i;

export interface DocRevision {
  /** The code without its /R suffix — the part that never changes. */
  base: string;
  /** 1 for a bare code, else the number after /R. */
  revision: number;
}

export function parseDocRevision(code: string | null | undefined): DocRevision {
  const v = (code ?? '').trim();
  const m = v.match(DOC_REVISION_RE);
  if (!m) return { base: v, revision: 1 };
  return { base: v.slice(0, v.length - m[0].length).trim(), revision: Number(m[1]) };
}

/** `withDocRevision('IN-MPO-00005', 2)` → `'IN-MPO-00005/R2'`. */
export function withDocRevision(base: string, revision: number): string {
  return `${base}/R${revision}`;
}

/** The next revision of a code: bare → /R2, /R2 → /R3. */
export function bumpDocRevision(code: string): string {
  const { base, revision } = parseDocRevision(code);
  return withDocRevision(base, revision + 1);
}

/** The accepted prefixes for a type. PO has five; every other type has one. */
export function docNumberPrefixes(type: DocNumberType): readonly string[] {
  return type === 'purchase_order' ? PO_CODE_PREFIXES : [DOC_NUMBER_FORMATS[type].prefix];
}

/** Types whose codes carry a /R revision suffix. */
const REVISIONED: ReadonlySet<DocNumberType> = new Set<DocNumberType>([
  'purchase_order',
  'delivery_challan',
]);

export function docNumberHasRevision(type: DocNumberType): boolean {
  return REVISIONED.has(type);
}

/** Strict pattern for a type: one of its accepted prefixes, the exact digit
 *  count, and — on a revisioned type — an optional `/R<n>` tail.
 *
 *  sales_order    →  /^(?:IN-SO-)\d{5}$/
 *  purchase_order →  /^(?:IN-JWPO-|IN-MPO-|IN-OPO-|IN-SPO-|IN-PO-)\d{5}(?:\/R\d+)?$/ */
export function docNumberPattern(type: DocNumberType): RegExp {
  const f = DOC_NUMBER_FORMATS[type];
  const prefixes = docNumberPrefixes(type).map(escapeRe).join('|');
  const rev = docNumberHasRevision(type) ? String.raw`(?:\/R\d+)?` : '';
  return new RegExp(String.raw`^(?:${prefixes})\d{${f.digits}}${rev}$`);
}

/** Pad a user-typed value to the canonical form: keep the prefix (or add it),
 *  zero-pad the trailing digits to the expected width. Returns the input
 *  unchanged when it can't be confidently normalised. */
export function padDocNumber(type: DocNumberType, value: string): string {
  const f = DOC_NUMBER_FORMATS[type];
  const v = value.trim();
  if (!v) return v;
  // A typed /R tail is held back and the padding works on the part in front of
  // it, so "IN-MPO-7/R2" normalises to "IN-MPO-00007/R2" rather than running
  // the 7 and the 2 together into one string of digits.
  const { base, revision } = parseDocRevision(v);
  const hadRevision = base !== v;
  // Whichever accepted prefix was typed is the one kept — a job-work PO typed
  // as "IN-JWPO-7" must not come back as "IN-PO-00007". PO_CODE_PREFIXES is
  // ordered longest-first so IN-PO- cannot shadow IN-MPO-.
  const typed = docNumberPrefixes(type).find((pre) =>
    base.toUpperCase().startsWith(pre.toUpperCase()),
  );
  const prefix = typed ?? f.prefix;
  const withoutPrefix = typed ? base.slice(typed.length) : base;
  const digitsOnly = withoutPrefix.replace(/\D/g, '');
  if (!digitsOnly) return v;
  const padded = `${prefix}${digitsOnly.padStart(f.digits, '0')}`;
  return hadRevision ? withDocRevision(padded, revision) : padded;
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
  opts: { formatInvalid: boolean; duplicate: boolean; poType?: PoType },
): string | null {
  if (opts.formatInvalid) {
    const f = DOC_NUMBER_FORMATS[type];
    // Name the series the form is actually ON. Every purchase order used to be
    // IN-PO-, so the message could name one prefix and be right; now a buyer on
    // a job-work PO who mistypes must be told IN-JWPO-, not the retired series.
    // With no poType (a non-PO form, or an older caller) this is the legacy
    // prefix, exactly as before.
    const prefix =
      type === 'purchase_order' && opts.poType ? poCodePrefix(opts.poType) : f.prefix;
    const rev = docNumberHasRevision(type) ? '/R1' : '';
    return `Invalid format — expected ${prefix}${'N'.repeat(f.digits)}${rev}`;
  }
  if (opts.duplicate) return 'Duplicate — this number already exists';
  return null;
}

// ── Endpoint contract ──
export const checkDocNumberQuerySchema = z.object({
  type: z.enum(DOC_NUMBER_TYPES),
  /** Code to check; when omitted, only the suggested next code is returned. */
  code: z.string().trim().max(64).optional(),
  /** PURCHASE ORDERS ONLY. Each PO type has its own series and its own running
   *  number, so the suggested next code depends on which type the form is on.
   *  Omitted (or sent for another document type) falls back to the legacy
   *  IN-PO- series, which is what an older client will get. */
  poType: z.enum(PO_TYPES).optional(),
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
