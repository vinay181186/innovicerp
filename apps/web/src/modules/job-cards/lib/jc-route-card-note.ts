// ADR-282 — how a Job Card screen words its Route Card. One place, so New Job
// Card, Edit Job Card, the Differs notice and the print cannot disagree.

import type { JcRouteCardWriteBack, JobCardListItem } from '@innovic/shared';
import type { ToastApi } from '@/ui/feedback';

/** What a save or a Send to Route Card did to the Route Card, in plain words. */
export function routeCardWriteBackNote(rc: JcRouteCardWriteBack): {
  tone: 'info' | 'warn';
  text: string;
} {
  // ADR-249 — it could not be sent: the card is unchanged, so no "updated" line.
  if (rc.notSentReason) return { tone: 'warn', text: rc.notSentReason };
  if (rc.sentForApproval) {
    return {
      tone: 'info',
      text: 'Route Card change sent for approval — the card is unchanged until approved.',
    };
  }
  if (rc.created) {
    return {
      tone: 'info',
      text: `Route Card ${rc.routeCardCode} created (Route Card Rev ${rc.routeCardRevision}) from this Job Card's operations — waiting for approval before it can be used.`,
    };
  }
  return {
    tone: 'info',
    text: `Route Card ${rc.routeCardCode} updated to Route Card Rev ${rc.routeCardRevision} — this Job Card's operations are now the item's standard routing.`,
  };
}

/** The same outcome as a toast. A not-sent reason is a warning that stays until
 *  dismissed: toasts outlive the page, so it can still be read after the screen
 *  has moved on. */
export function toastRouteCardWriteBack(
  toast: ToastApi,
  rc: JcRouteCardWriteBack,
  lead?: string,
): void {
  const note = routeCardWriteBackNote(rc);
  const text = lead ? `${lead} ${note.text}` : note.text;
  if (note.tone === 'warn') toast.show(text, { kind: 'warn', durationMs: 0 });
  else toast.ok(text);
}

/** "Route Card Rev 2 · Card now Rev 3": the Rev this Job Card was built on, then
 *  where the card is today when it has moved on. Null = an old hand-made card
 *  that never recorded one: shown blank, never guessed. */
export function jcRouteCardRevLabel(
  jc: Pick<JobCardListItem, 'routeCardBuiltRevision' | 'routeCardRevision'>,
): string | null {
  const built = jc.routeCardBuiltRevision;
  if (built == null) return null;
  const now = jc.routeCardRevision;
  return `Route Card Rev ${built}${now != null && now !== built ? ` · Card now Rev ${now}` : ''}`;
}
