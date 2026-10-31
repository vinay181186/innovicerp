// ADR-264 — small display helpers for the bell and All notifications.

import { addDaysLocal, fmtDateTime, fmtTime, todayIst } from '@/lib/date';

/** "Shivani Patel" → "SP", "Kajal" → "KA"; null (a system event) → "•". */
export function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '•';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (first[1] ?? '');
  return ((first[0] ?? '') + second).toUpperCase();
}

/** The IST calendar day of an ISO time, as YYYY-MM-DD. */
export function istDay(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

export type DayGroup = 'Today' | 'Yesterday' | 'Earlier';

export function dayGroup(ts: string): DayGroup {
  const d = istDay(ts);
  const today = todayIst();
  if (d === today) return 'Today';
  if (d === addDaysLocal(today, -1)) return 'Yesterday';
  return 'Earlier';
}

/** "just now", "12 min ago", "3 hrs ago" today; "Yesterday 17:40"; else "29-Oct-2026 15:30". */
export function relTime(ts: string, now = Date.now()): string {
  const g = dayGroup(ts);
  if (g === 'Today') {
    const min = Math.max(0, Math.floor((now - Date.parse(ts)) / 60_000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60);
    return `${h} ${h === 1 ? 'hr' : 'hrs'} ago`;
  }
  if (g === 'Yesterday') return `Yesterday ${fmtTime(ts)}`;
  return fmtDateTime(ts);
}

/** The first document link in a notification's text — what clicking it opens. */
export function firstHref(
  text: ReadonlyArray<{ text: string } | { code: string; href: string }>,
): string | null {
  for (const p of text) if ('href' in p) return p.href;
  return null;
}
