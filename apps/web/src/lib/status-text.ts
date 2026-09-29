// A stored status / type code → the words the user reads, for screens that
// show statuses from MANY document types in one column (global search, related
// documents, task links). The codes themselves are never changed — this is
// display text only. Wording follows the settled rules: finished = Completed,
// part-way = Partly <verb>, QC waiting = QC Pending.

const STATUS_TEXT: Record<string, string> = {
  rework_done: 'Rework Completed',
  grn_qc: 'GRN QC',
  jw_in: 'JW In',
  jw_out: 'JW Out',
  qc_pending: 'QC Pending',
  pending_qc: 'QC Pending',
  complete: 'Completed',
  done: 'Completed',
  no_ops: 'No Operations',
  pr_raised: 'PR Raised',
  pr_created: 'PR Created',
  po_created: 'PO Created',
  jc_created: 'JC Created',
  ready_for_pr: 'Ready for PR',
  short_closed: 'Short Closed',
  partially_closed: 'Partly Closed',
  partially_paid: 'Partly Paid',
  partially_received: 'Partly Received',
  partially_returned: 'Partly Returned',
  partially_accepted: 'Partly Accepted',
  partial_accept: 'Partly Accepted',
  partially_planned: 'Partly Planned',
  use_as_is: 'Use As Is',
  todo: 'To Do',
  to_do: 'To Do',
};

/** "in_progress" → "In Progress". */
export function titleCaseCode(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * The label for a status code. `partial` depends on the document: an invoice
 * is Partly Paid, a return Partly Returned, everything else Partly Received.
 */
export function statusText(raw: string, kind?: string | null): string {
  const key = raw.trim().toLowerCase().replace(/ /g, '_');
  if (key === 'partial') {
    if (kind && kind.includes('invoice')) return 'Partly Paid';
    if (kind && (kind.includes('return') || kind.includes('tool'))) return 'Partly Returned';
    return 'Partly Received';
  }
  // A value that already carries capitals ("BOM Pending") is already words.
  return (
    STATUS_TEXT[key] ?? (/[A-Z]/.test(raw) ? raw.replace(/_/g, ' ') : titleCaseCode(raw.trim()))
  );
}
