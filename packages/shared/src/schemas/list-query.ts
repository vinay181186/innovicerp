// Sort & Filter (ADR-200) — the ONE contract a list endpoint accepts when a
// screen sorts / filters on the SERVER (paged and capped lists). The screen
// sends a single `sf` query param holding JSON; the endpoint maps each `field`
// through its own column whitelist (apps/api/src/lib/list-query.ts). The same
// operator names and the same date presets are used by the browser mode
// (apps/web/src/ui/data/sort-filter/filter-model.ts), so a filter means the
// same thing wherever it runs.

import { z } from 'zod';

export const SF_TEXT_OPS = ['contains', 'notContains', 'equals', 'begins'] as const;
export const SF_NUM_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'] as const;
export const SF_DATE_PRESETS = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
] as const;
export const SF_DATE_OPS = ['on', 'before', 'after', 'between', ...SF_DATE_PRESETS] as const;

export type SfTextOp = (typeof SF_TEXT_OPS)[number];
export type SfNumOp = (typeof SF_NUM_OPS)[number];
export type SfDatePreset = (typeof SF_DATE_PRESETS)[number];
export type SfDateOp = (typeof SF_DATE_OPS)[number];

/** The tick-list entry for an empty cell. */
export const SF_BLANK = '(Blanks)';
/** Most filters one request may carry. */
export const SF_MAX_FILTERS = 10;

const field = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sfFilterSchema = z.discriminatedUnion('kind', [
  z.object({
    field,
    kind: z.literal('values'),
    values: z.array(z.string().max(200)).max(200),
  }),
  z.object({
    field,
    kind: z.literal('text'),
    op: z.enum(SF_TEXT_OPS),
    q: z.string().min(1).max(200),
  }),
  z.object({
    field,
    kind: z.literal('num'),
    op: z.enum(SF_NUM_OPS),
    a: z.number().finite(),
    b: z.number().finite().optional(),
  }),
  z.object({
    field,
    kind: z.literal('date'),
    op: z.enum(SF_DATE_OPS),
    from: ymd.optional(),
    to: ymd.optional(),
  }),
]);
export type SfFilter = z.infer<typeof sfFilterSchema>;

export const sfQuerySchema = z.object({
  sort: z
    .object({ field, dir: z.enum(['asc', 'desc']) })
    .nullable()
    .default(null),
  filters: z.array(sfFilterSchema).max(SF_MAX_FILTERS).default([]),
});
export type SfQuery = z.infer<typeof sfQuerySchema>;

/**
 * JSON text → SfQuery. INTERNAL to the server's `readSf()` — a list endpoint's
 * query schema declares `sf: sfRawParamSchema` (a plain string, so the screen
 * and the server share one query type) and the service calls `readSf(input.sf)`.
 */
export const sfParamSchema = z
  .string()
  .max(4000)
  .transform((s, ctx): SfQuery => {
    let raw: unknown;
    try {
      raw = JSON.parse(s);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sf is not valid JSON' });
      return z.NEVER;
    }
    const parsed = sfQuerySchema.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sf is not a valid sort / filter' });
      return z.NEVER;
    }
    return parsed.data;
  })
  .optional();

// ── date presets (India time, week starts Monday) ──────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` plus `n` days (calendar arithmetic, no time zone involved). */
export function sfAddDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return sfAddDays(day, -((dow + 6) % 7));
}

function monthEnd(y: number, m: number): string {
  return `${y}-${pad2(m)}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Inclusive [from, to] of a preset, counted from `today` (an IST `YYYY-MM-DD`). */
export function sfPresetRange(p: SfDatePreset, today: string): [string, string] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (p) {
    case 'today':
      return [today, today];
    case 'yesterday': {
      const d = sfAddDays(today, -1);
      return [d, d];
    }
    case 'thisWeek': {
      const s = weekStart(today);
      return [s, sfAddDays(s, 6)];
    }
    case 'lastWeek': {
      const s = sfAddDays(weekStart(today), -7);
      return [s, sfAddDays(s, 6)];
    }
    case 'thisMonth':
      return [`${y}-${pad2(m)}-01`, monthEnd(y, m)];
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return [`${py}-${pad2(pm)}-01`, monthEnd(py, pm)];
    }
  }
}

/**
 * The inclusive day range a date filter selects, or nulls for an open end.
 * `to` is used only by `between` (a stale one under on / before / after is
 * ignored); a reversed range is read the way the user meant it.
 */
export function sfDateRange(
  op: SfDateOp,
  from: string | undefined,
  to: string | undefined,
  today: string,
): { from: string | null; to: string | null } {
  let a: string | null = from ?? null;
  let b: string | null = op === 'between' ? (to ?? null) : null;
  if (op === 'on') b = a;
  else if (op === 'before') {
    b = a ? sfAddDays(a, -1) : null;
    a = null;
  } else if (op === 'after') {
    a = a ? sfAddDays(a, 1) : null;
  } else if (op !== 'between') {
    [a, b] = sfPresetRange(op, today);
  }
  if (a && b && a > b) [a, b] = [b, a];
  return { from: a, to: b };
}

/** Today's date in India as `YYYY-MM-DD`, wherever the code runs. */
export function sfTodayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The raw `sf` param as a list endpoint's query schema declares it — a plain
 * string, so screens and server share one query type. The service reads it
 * with `readSf()` (apps/api/src/lib/list-query.ts), which applies
 * `sfParamSchema` and answers a bad value with a 400.
 */
export const sfRawParamSchema = z.string().max(4000).optional();

/** Screen side: the `sf` param for a sort + filters, or undefined when there is none. */
export function encodeSf(q: SfQuery): string | undefined {
  if (q.sort === null && q.filters.length === 0) return undefined;
  return JSON.stringify(q);
}
