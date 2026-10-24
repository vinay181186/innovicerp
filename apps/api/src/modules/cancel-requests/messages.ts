// ADR-235 — the plain sentences the Cancel Request flow answers with. Pure, so
// they are unit-tested without a database (messages.test.ts).

import type { CancelBlocker } from '@innovic/shared';

/** "IN-CD-00012 can't be cancelled yet — cancel these first: Invoice
 *  IN-INV-00031 (Ln 2 is invoiced (40 pcs)); …" */
export function blockerRefusal(docCode: string, blockers: readonly CancelBlocker[]): string {
  const list = blockers.map((b) => `${b.docLabel} ${b.docNo} (${b.reason})`).join('; ');
  return `${docCode} can't be cancelled yet — cancel these first: ${list}.`;
}

/** 409 on a second request while one is open. */
export function alreadyPendingMessage(docCode: string, requestedByName: string | null): string {
  return requestedByName
    ? `A cancel request for ${docCode} is already pending (requested by ${requestedByName}).`
    : `A cancel request for ${docCode} is already pending.`;
}

/** 409 when a request was decided by someone else first. */
export function alreadyDecidedMessage(
  docCode: string,
  status: string,
  decidedByName: string | null,
  decidedAt: Date | string | null,
): string {
  const who = decidedByName ? ` by ${decidedByName}` : '';
  const when = decidedAt ? ` at ${formatIst(decidedAt)}` : '';
  return `The cancel request for ${docCode} was already ${status}${who}${when} — reload the page.`;
}

/** dd-MM-yyyy HH:mm in IST — the app's display time zone. */
export function formatIst(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

/** 409 when a staged edit (ADR-202) waits on the same document. */
export function stagedEditMessage(docCode: string): string {
  return `${docCode} has an edit waiting for approval — decide it first.`;
}
