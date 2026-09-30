// GST master rules — ONE home for the State list, GST Category list and the
// GSTIN / HSN checks (plan v3 Step 2, owner decisions D1 / D3, ERPNext India
// Compliance). The Customer / Vendor / Item forms, the API services and the
// Excel importers all call these functions, so the screen, the server and the
// import can never disagree.
//
// Sources (india-compliance@develop):
//   - constants/__init__.py  STATE_NUMBERS, GST_CATEGORIES, GSTIN_FORMATS
//   - utils/__init__.py      validate_gstin, validate_gstin_check_digit,
//                            validate_gst_category
//
// Nothing here throws: every check returns plain-English problems, and the
// caller decides (Master Rules Mode) whether a problem is a warning or a refusal.

/** One Indian State / Union Territory with its GST state code (first two digits
 *  of a GSTIN). 96 / 97 are the GST codes for a party outside India / in an
 *  "other territory". 25 (old Daman and Diu) and 28 (old Andhra Pradesh) are
 *  retired — both were merged into 26 / 37. */
export interface IndianState {
  code: string;
  name: string;
}

export const INDIAN_STATES: readonly IndianState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '96', name: 'Other Countries' },
  { code: '97', name: 'Other Territory' },
] as const;

export const INDIAN_STATE_CODES = INDIAN_STATES.map((s) => s.code);

const STATE_BY_CODE = new Map(INDIAN_STATES.map((s) => [s.code, s]));

/** Screen word for a stored State Code, e.g. '24' → 'Gujarat'. Null for an
 *  unknown / blank code. */
export function stateNameForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_BY_CODE.get(code)?.name ?? null;
}

/** 'Gujarat' + '24' → 'Gujarat (24)' — the pick-list / detail rendering. */
export function stateLabel(code: string | null | undefined): string {
  const n = stateNameForCode(code);
  return n && code ? `${n} (${code})` : '';
}

/** Lower-case, '&' → 'and', letters and digits only — so "Jammu & Kashmir",
 *  "jammu and kashmir" and "JAMMU-KASHMIR" compare equal. Migration 0183 uses
 *  the SAME normalisation in SQL for the one-time backfill. */
export function normalizeStateKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** Old names, common spellings and the two-letter vehicle-registration codes
 *  people type into a State cell. Keys are already normalised. Only aliases that
 *  can mean exactly ONE state are listed — anything else stays unmapped and is
 *  shown for review instead of being guessed. Kept in step with the VALUES list
 *  in migration 0183. */
export const STATE_ALIASES: Readonly<Record<string, string>> = {
  jandk: '01',
  jk: '01',
  hp: '02',
  pb: '03',
  ch: '04',
  uttaranchal: '05',
  uk: '05',
  hr: '06',
  newdelhi: '07',
  nctofdelhi: '07',
  nctdelhi: '07',
  dl: '07',
  rj: '08',
  up: '09',
  br: '10',
  sk: '11',
  ar: '12',
  nl: '13',
  mn: '14',
  mz: '15',
  tr: '16',
  ml: '17',
  as: '18',
  wb: '19',
  jh: '20',
  orissa: '21',
  od: '21',
  chattisgarh: '22',
  chhatisgarh: '22',
  cg: '22',
  mp: '23',
  gujrat: '24',
  gj: '24',
  damananddiu: '26',
  dadraandnagarhaveli: '26',
  dnhdd: '26',
  maharastra: '27',
  mh: '27',
  ka: '29',
  ga: '30',
  ld: '31',
  kl: '32',
  tn: '33',
  pondicherry: '34',
  py: '34',
  andamanandnicobar: '35',
  an: '35',
  telengana: '36',
  ts: '36',
  tg: '36',
  ap: '37',
  la: '38',
};

const STATE_BY_KEY = new Map<string, string>([
  ...INDIAN_STATES.map((s) => [normalizeStateKey(s.name), s.code] as [string, string]),
  ...Object.entries(STATE_ALIASES),
]);

/** Free text → GST State Code, or null when it matches no state
 *  unambiguously. Accepts the name ("Gujarat"), a known alias ("Gujrat",
 *  "GJ"), the bare code ("24" / "4") or "24 - Gujarat" / "Gujarat (24)". */
export function resolveStateCode(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  // "24", "4", "24 - Gujarat", "Gujarat (24)": a code in the text wins only if
  // any name in the same text agrees with it.
  const digits = /\b(\d{1,2})\b/.exec(text);
  if (!digits) return STATE_BY_KEY.get(normalizeStateKey(text)) ?? null;
  const code = digits[1]!.padStart(2, '0');
  if (!STATE_BY_CODE.has(code)) return null;
  const nameKey = normalizeStateKey(text.replace(/\b\d{1,2}\b/g, ''));
  if (nameKey && STATE_BY_KEY.get(nameKey) !== code) return null;
  return code;
}

// ── GST Category (D1) ────────────────────────────────────────────────────────

/** GST Category of a customer / vendor — the ERPNext India Compliance list,
 *  first five (owner decision D1). Stored in clients.gst_category /
 *  vendors.gst_category; NULL = not chosen yet. */
export const GST_CATEGORIES = [
  'registered_regular',
  'registered_composition',
  'unregistered',
  'sez',
  'overseas',
] as const;
export type GstCategory = (typeof GST_CATEGORIES)[number];

export const GST_CATEGORY_LABEL: Record<GstCategory, string> = {
  registered_regular: 'Registered Regular',
  registered_composition: 'Registered Composition',
  unregistered: 'Unregistered',
  sez: 'SEZ',
  overseas: 'Overseas',
};

/** Screen word for a stored GST Category code; '' for blank. */
export function gstCategoryLabel(c: string | null | undefined): string {
  if (!c) return '';
  return (GST_CATEGORY_LABEL as Record<string, string>)[c] ?? c;
}

/** Categories that do NOT need a GSTIN (India Compliance validate_gst_category). */
export const GST_CATEGORIES_WITHOUT_GSTIN: readonly GstCategory[] = ['unregistered', 'overseas'];

/** Import / free-text → GST Category code: accepts the code or the label,
 *  any case, spaces or underscores. Null when nothing matches. */
export function resolveGstCategory(raw: string | null | undefined): GstCategory | null {
  const k = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!k) return null;
  for (const c of GST_CATEGORIES) {
    if (c === k || GST_CATEGORY_LABEL[c].toLowerCase().replace(/\s+/g, '_') === k) return c;
  }
  if (k === 'regular' || k === 'registered') return 'registered_regular';
  if (k === 'composition') return 'registered_composition';
  return null;
}

// ── GSTIN ────────────────────────────────────────────────────────────────────

/** Normal taxpayer GSTIN: 2-digit state, 10-char PAN, entity no., 'Z', check char. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character a GSTIN must end with, computed from its first 14 (the
 *  GSTN mod-36 check digit, same as India Compliance
 *  validate_gstin_check_digit). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14.charAt(i));
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36);
}

/** Tidy a typed GSTIN: trim, upper-case, drop inner spaces. '' → null. */
export function normalizeGstin(raw: string | null | undefined): string | null {
  const g = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return g.length === 0 ? null : g;
}

/** Check ONE GSTIN (already normalised). Returns the problem in plain English,
 *  or null when it is a well-formed GSTIN with the right check digit. */
export function gstinProblem(gstin: string): string | null {
  if (gstin.length !== 15) return `GSTIN must be 15 characters (this one has ${gstin.length}).`;
  if (!GSTIN_PATTERN.test(gstin)) {
    return 'GSTIN is not in the right pattern (2-digit State Code, 10-character PAN, 1 entity digit, "Z", 1 check character).';
  }
  if (!STATE_BY_CODE.has(gstin.slice(0, 2))) {
    return `GSTIN starts with ${gstin.slice(0, 2)}, which is not a GST State Code.`;
  }
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin.charAt(14)) {
    return 'GSTIN check digit is wrong — one of the characters is mistyped.';
  }
  return null;
}

// ── HSN (D3) ─────────────────────────────────────────────────────────────────

/** Minimum HSN digits the company can require (India Compliance: 4 / 6 / 8). */
export const HSN_MIN_DIGITS_OPTIONS = [4, 6, 8] as const;
export type HsnMinDigits = (typeof HSN_MIN_DIGITS_OPTIONS)[number];
export const HSN_MIN_DIGITS_DEFAULT: HsnMinDigits = 6;

/** Check ONE HSN / SAC code. A valid code is all digits, 4, 6 or 8 long, and at
 *  least `minDigits` long. Returns the problem, or null. */
export function hsnProblem(hsn: string, minDigits: number): string | null {
  if (!/^[0-9]+$/.test(hsn)) return 'HSN Code must contain digits only.';
  if (![4, 6, 8].includes(hsn.length)) return 'HSN Code must be 4, 6 or 8 digits.';
  if (hsn.length < minDigits) return `HSN Code must be at least ${minDigits} digits.`;
  return null;
}
