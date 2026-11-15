// ADR-293 — shape a service's answer for the AI: drop uuids, nulls and empty
// values, cap every list at 50 rows and the whole text at ~30 000 characters.
export const TOOL_ROW_CAP = 50;
export const TOOL_CHARS_CAP = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUNCATED_NOTE = 'truncated: narrow the question';

function strip(v: unknown, cut: { hit: boolean }): unknown {
  if (Array.isArray(v)) {
    if (v.length > TOOL_ROW_CAP) cut.hit = true;
    return v.slice(0, TOOL_ROW_CAP).map((x) => strip(x, cut));
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      // Row ids / foreign ids mean nothing to a reader; codes are kept.
      if (typeof x === 'string' && UUID.test(x)) continue;
      if (x === null || x === undefined || x === '') continue;
      if (Array.isArray(x) && x.length === 0) continue;
      out[k] = strip(x, cut);
    }
    return out;
  }
  return v;
}

/** The longest array anywhere inside `v` (the rows), or null. */
function longestArray(v: unknown): unknown[] | null {
  const children = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
  let best: unknown[] | null = Array.isArray(v) ? v : null;
  for (const c of children) {
    const inner = longestArray(c);
    if (inner && (!best || inner.length > best.length)) best = inner;
  }
  return best;
}

export interface CompactResult {
  text: string;
  /** Rows in the main list of the output (1 for a single document). */
  rows: number;
}

export function compactForAi(value: unknown): CompactResult {
  const cut = { hit: false };
  const data = strip(value, cut);
  const rows = longestArray(data)?.length ?? (data === undefined ? 0 : 1);
  let text = JSON.stringify(data) ?? 'null';
  // Too long: halve the biggest list until it fits.
  for (let arr = longestArray(data); text.length > TOOL_CHARS_CAP && arr && arr.length > 1; ) {
    arr.length = Math.ceil(arr.length / 2);
    cut.hit = true;
    text = JSON.stringify(data) ?? 'null';
    arr = longestArray(data);
  }
  if (text.length > TOOL_CHARS_CAP) {
    text = text.slice(0, TOOL_CHARS_CAP);
    cut.hit = true;
  }
  return { text: cut.hit ? `${text}\n(${TRUNCATED_NOTE})` : text, rows };
}
