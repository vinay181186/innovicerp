// Shared Excel/CSV import primitives. Every module importer (items, clients,
// vendors, operators, sales-orders, job-work-orders, bom-master) used to
// re-implement `getCol` + the SheetJS read preamble + status/enum coercion
// byte-for-byte. This is the single canonical implementation so a fix lands
// once instead of six times, and header matching / status parsing behave
// identically on every screen.
//
// Header matching is NORMALIZED: keys are trimmed, whitespace-collapsed,
// lowercased, and stripped of a trailing "*"/"." decoration before comparison.
// So "UOM", "uom", "Uom ", and "U O M" all match the alias "uom" — the old
// per-parser behaviour was case-sensitive exact-match and silently dropped a
// renamed/space-suffixed column.

import * as XLSX from 'xlsx';

/** Canonical header key: trim, collapse internal whitespace, drop the "*"
 *  required-marker and stray dots, lowercase. Used for BOTH the sheet's header
 *  cells and the alias list, so matching is spelling/spacing/case tolerant. */
export function normalizeHeaderKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[*.]/g, '')
    .trim();
}

/** A sheet row with header keys already normalized (see normalizeHeaderKey) and
 *  every value coerced to a trimmed string (Date cells → ISO yyyy-mm-dd). */
export type NormalizedRow = Record<string, string>;

export interface SheetReadResult {
  rows: NormalizedRow[];
  /** Set when the workbook has no readable sheet; callers surface it as a fatal error. */
  sheetError?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Read the first sheet of an .xlsx/.xls/.csv file into normalized-key rows.
 *  `cellDates` is passed through to SheetJS — pass true when the sheet carries
 *  date columns (SO/JW due dates) so date cells arrive as Date objects, which
 *  we normalize to yyyy-mm-dd strings here. */
export async function readSheetRows(
  file: File,
  opts?: { cellDates?: boolean },
): Promise<SheetReadResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: opts?.cellDates ?? false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { rows: [], sheetError: 'Workbook has no sheets' };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const rows: NormalizedRow[] = raw.map((r) => {
    const out: NormalizedRow = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined || v === null) continue;
      const nk = normalizeHeaderKey(k);
      const s = v instanceof Date ? isoDate(v) : String(v).trim();
      // First non-empty value wins if two headers normalize to the same key.
      if (out[nk] === undefined || out[nk] === '') out[nk] = s;
    }
    return out;
  });
  return { rows };
}

/** First non-empty value among the given header aliases (matched normalized). */
export function getCol(row: NormalizedRow, aliases: string[]): string {
  for (const a of aliases) {
    const v = row[normalizeHeaderKey(a)];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

/** True when a row has no value under any of the given aliases (blank row). */
export function rowIsBlank(row: NormalizedRow, aliases: string[]): boolean {
  return getCol(row, aliases) === '';
}

export interface CoercionResult<T> {
  value: T;
  /** Human-readable note when the raw value was unrecognized and a default was
   *  applied — callers should surface it as a per-row warning, never silently. */
  warning?: string;
}

const INACTIVE_TOKENS = new Set([
  'inactive', 'inact', 'no', 'n', 'false', '0', 'disabled',
  'deactivated', 'closed', 'dormant', 'archived', 'off',
]);
const ACTIVE_TOKENS = new Set(['active', 'act', 'yes', 'y', 'true', '1', 'enabled', 'on', '']);

/** Parse an "Active/Inactive" status cell. Blank → Active (no warning).
 *  Unrecognized → Active WITH a warning (the old code silently treated
 *  anything not literally containing "inact" as Active). */
export function parseActiveStatus(raw: string): CoercionResult<boolean> {
  const s = raw.trim().toLowerCase();
  if (INACTIVE_TOKENS.has(s)) return { value: false };
  if (ACTIVE_TOKENS.has(s)) return { value: true };
  return { value: true, warning: `unrecognized status "${raw}" — defaulted to Active` };
}

/** Coerce a raw cell to a member of `allowed`, or `fallback` WITH a warning.
 *  Replaces the parsers' silent normalizeUom/normalizeItemType defaulting. */
export function coerceEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
  opts: { fallback: T; label: string; transform?: (s: string) => string },
): CoercionResult<T> {
  const t = (opts.transform ? opts.transform(raw) : raw).trim();
  if (t === '') return { value: opts.fallback };
  if ((allowed as readonly string[]).includes(t)) return { value: t as T };
  return {
    value: opts.fallback,
    warning: `unrecognized ${opts.label} "${raw}" — defaulted to ${opts.fallback}`,
  };
}

/** Parse a numeric cell. Blank/non-numeric → null (callers decide skip vs 0). */
export function coerceNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a date cell to yyyy-mm-dd. Accepts ISO (or ISO-prefixed), and
 *  dd/mm/yyyy or dd-mm-yyyy (Indian convention). Unrecognized → undefined. */
export function coerceDate(raw: string): string | undefined {
  const s = raw.trim();
  if (s === '') return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, mo, y] = dmy;
    return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return undefined;
}
