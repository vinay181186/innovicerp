// ADR-185 — one rule for "may new work be raised against this Sales Order?",
// shared by plan create, dispatch create and invoice create so the three
// cannot drift apart when a status is added. A draft is not yet committed and
// a cancelled order is dead; every other status (open, closed = produced,
// dispatched) still accepts its downstream documents.

import { ValidationError } from './errors';

export function assertSoAcceptsWork(status: string, soCode: string, action: string): void {
  if (status === 'draft' || status === 'cancelled') {
    throw new ValidationError(
      `${soCode} is ${status === 'draft' ? 'a draft' : 'cancelled'} — ${action}.`,
    );
  }
}
