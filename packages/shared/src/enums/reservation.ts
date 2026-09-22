// Stock reservation vocabulary (ADR-180).
//
// A reservation BOOKS physical stock to an SO line without moving it. The
// three numbers the whole ERP now uses:
//
//   PHYSICAL  = item_stock_balances.on_hand_qty — what is actually on the shelf
//   RESERVED  = Σ (reserved_qty − consumed_qty − released_qty) of active rows
//   AVAILABLE = PHYSICAL − RESERVED
//
// Reserving changes AVAILABLE → RESERVED and never touches PHYSICAL. Only a
// real stock-out (dispatch, issue) reduces PHYSICAL. This replaces the Stage-1
// "hard move" (migration 0099), which posted a store_transactions 'out' row at
// reserve time and so made PHYSICAL fall when nothing had left the building.

export const RESERVATION_STATUSES = [
  /** Holding stock; nothing shipped against it yet. */
  'active',
  /** Some of the reserved qty has been dispatched, some is still held. */
  'partially_consumed',
  /** Every reserved piece has been dispatched. */
  'consumed',
  /** Given back to free stock by a user, or by an SO amendment. */
  'released',
  /** Voided (the SO line itself was cancelled). */
  'cancelled',
  /** Retired Stage-1 value. Holds nothing; kept in the union so a historical
   *  row still renders a label instead of a blank cell (migration 0141 keeps
   *  it legal in the DB check constraint). Never written by new code. */
  'dispatched',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that still hold stock — the ones RESERVED is summed over. */
export const ACTIVE_RESERVATION_STATUSES = ['active', 'partially_consumed'] as const;

export const RESERVATION_SOURCES = [
  /** Created by the system when a Production Order close credited finished goods. */
  'auto_production',
  /** Created by a planner pressing Allocate on the planning screen. */
  'manual',
] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export const RESERVATION_SOURCE_LABEL: Record<ReservationSource, string> = {
  auto_production: 'Auto (production)',
  manual: 'Manual',
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  active: 'Active',
  partially_consumed: 'Partly dispatched',
  consumed: 'Dispatched',
  released: 'Released',
  cancelled: 'Cancelled',
  dispatched: 'Dispatched (legacy)',
};
