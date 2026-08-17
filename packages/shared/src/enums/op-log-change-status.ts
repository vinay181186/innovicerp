// Lifecycle of a requested date/time correction on an op entry (ADR-130).
// 'pending' is the only state in which the entry itself is untouched — the
// requested value lives on the request row and NO production number moves.
export const OP_LOG_CHANGE_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type OpLogChangeStatus = (typeof OP_LOG_CHANGE_STATUSES)[number];
