import type { BomStatus } from '../enums/bom-status';
import { NC_STATUSES, type NcStatus } from '../enums/nc-status';
import type { SoStatus } from '../enums/so-status';

// Allowed status moves per document (fix wave 2, step 2b — finding S8).
//
// ERPNext checks every status change in the document's validate() on the
// server, so a hand-made API call cannot jump a document to any status it
// likes. These maps are that rule, in one place: the API refuses any move not
// listed (409), and the web shows only the buttons / choices a map allows.
//
// A map lists the moves a PERSON may make (save, a button). Moves the system
// makes on its own (an SO rolling up to Closed / Dispatched from dispatches,
// an NC closing when its recovery settles) are listed too where the code that
// makes them checks the map; they are marked "system".
// Re-saving the same status is never a move and is always allowed.

export type StatusMoves<S extends string> = Readonly<Record<S, readonly S[]>>;

/** True when `from → to` is allowed (or is no change at all). */
export function canMoveStatus<S extends string>(moves: StatusMoves<S>, from: S, to: S): boolean {
  return from === to || (moves[from] ?? []).includes(to);
}

/** Every status that may move INTO `to` — for a guarded UPDATE's WHERE clause. */
export function statusesThatMayMoveTo<S extends string>(moves: StatusMoves<S>, to: S): S[] {
  return (Object.keys(moves) as S[]).filter((from) => moves[from].includes(to));
}

/** The refusal sentence, in screen words. */
export function statusMoveRefusal(
  docLabel: string,
  from: string,
  to: string,
  labels: Readonly<Record<string, string>>,
): string {
  const f = labels[from] ?? from;
  const t = labels[to] ?? to;
  return `${docLabel} is ${f} — it cannot be changed to ${t}.`;
}

// ─── Sales Order ────────────────────────────────────────────────────────────
// A new SO is saved as Draft ("Save as Draft") or Open ("Save SO"). By hand it
// moves only between Draft and Open, or is Cancelled — once (D13: cancel once,
// no un-cancel). Closed / Dispatched are set by the system from dispatches and
// the Close action (ADR-184 / ADR-196), never by an edit.

/** Statuses an SO (or an SO line) may be created in. */
export const SO_CREATE_STATUSES: readonly SoStatus[] = ['draft', 'open'];

/** Moves a person may make by editing the SO (header or line). */
export const SO_STATUS_MOVES: StatusMoves<SoStatus> = {
  draft: ['open', 'cancelled'],
  open: ['draft', 'cancelled'],
  closed: [],
  dispatched: [],
  cancelled: [],
};

/** Statuses from which the Close (short) action is offered (ADR-196). */
export const SO_CLOSABLE_STATUSES: readonly SoStatus[] = ['open', 'dispatched', 'closed'];

// ─── BOM ───────────────────────────────────────────────────────────────────
// ERPNext BOM: made active (usable), later retired. Only an Active BOM may be
// linked to a Sales Order (checked on the server when the link is set or
// changed).
//
// ADR-223 — a new BOM is ALWAYS Active. It used to start as Draft and be
// promoted by hand, but Draft guarded nothing: a BOM cannot be saved at all
// without a name, a parent item and at least one line (form AND server), so
// there was never a half-built BOM to protect — only an extra step before the
// BOM could be used. Draft and Obsolete remain as STORED statuses and the moves
// below stay legal, but NO SCREEN SETS A BOM'S STATUS ANY MORE: the create and
// edit forms have no status field and a Retire action was declined (ADR-223
// §2a). Existing Draft BOMs keep their status; a BOM that is finished with is
// deleted. The only way to move one is a direct API update.

/** The status every new BOM is created in (ADR-223) — not a caller's choice. */
export const BOM_CREATE_STATUS: BomStatus = 'active';

export const BOM_STATUS_MOVES: StatusMoves<BomStatus> = {
  draft: ['active', 'obsolete'],
  active: ['obsolete'],
  obsolete: [],
};

/** The one BOM status an SO may link to. */
export const BOM_LINKABLE_STATUS: BomStatus = 'active';

// ─── Non-Conformance (NC) ─────────────────────────────────────────────────
// Every NC move is made by an action (Dispose, Send to Vendor, receipt QC,
// Close), never by a status field. The map is what those actions may do:
//   NC Raised → Disposed (return to vendor) / Under Rework / Under Repair /
//               Closed (scrap, use as is, make fresh)
//   Disposed → Sent to Vendor (challan issued) / Closed
//   Sent to Vendor → Received – QC Pending / Disposed (challan cancelled) / Closed
//   Received – QC Pending, Under Rework, Under Repair → Closed (system, when
//               the recovery QC settles the NC; or Close)
// `rework_done` is an old legacy status nothing writes any more: kept in the
// enum (old rows may hold it) and may still close, but hidden from filters.

export const NC_STATUS_MOVES: StatusMoves<NcStatus> = {
  pending: ['disposed', 'under_rework', 'under_repair', 'closed'],
  disposed: ['sent_to_vendor', 'closed'],
  sent_to_vendor: ['received_qc_pending', 'disposed', 'closed'],
  received_qc_pending: ['closed'],
  under_rework: ['closed'],
  under_repair: ['closed'],
  rework_done: ['closed'],
  closed: [],
};

/** NC statuses that are really written today — the ones a status filter offers. */
export const NC_FILTER_STATUSES: readonly NcStatus[] = NC_STATUSES.filter(
  (s) => s !== 'rework_done',
);
