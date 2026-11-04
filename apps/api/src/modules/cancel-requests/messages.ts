// ADR-235 — the plain sentences the Cancel Request flow answers with. Pure, so
// they are unit-tested without a database (messages.test.ts).

import type { CancelBlocker } from '@innovic/shared';
import { fmtDateTime } from '../../lib/format-date';

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

/** "24-10-2026 02:32 PM" in IST — the app's one date-time format
 *  (lib/format-date, owner decision 2026-11-03). */
export function formatIst(at: Date | string): string {
  return fmtDateTime(at);
}

/** 409 when a staged edit (ADR-202) waits on the same document. */
export function stagedEditMessage(docCode: string): string {
  return `${docCode} has an edit waiting for approval — decide it first.`;
}
