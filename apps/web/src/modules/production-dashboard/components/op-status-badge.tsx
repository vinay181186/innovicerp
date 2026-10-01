// Op-status badge for the Production Dashboard — split out of routes/index.tsx
// (ADR-199, file-size rule) so the machine-load widget and the Ready-to-process
// fit-table columns read ONE copy. Byte-identical to the map/component that used
// to live inline; no behaviour change.
//
// Legacy badge() (HTML L1959-1970) maps op status → colour. Wave 2 (owner,
// 2026-09-26): in_progress now reads "Partly Completed" (amber) and running (an
// open session) is green. Mirrors machine-loading's map.
export const OP_STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  complete: { label: 'Completed', cls: 'b-green' },
  in_progress: { label: 'Partly Completed', cls: 'b-amber' },
  running: { label: 'Running', cls: 'b-green' },
  available: { label: 'Available', cls: 'b-blue' },
  waiting: { label: 'Waiting', cls: 'b-grey' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
};

export function OpStatusBadge({ status }: { status: string }): React.JSX.Element {
  const known = OP_STATUS_BADGES[status];
  // Legacy's fallback is `m[status] || 'b-grey'` with the raw status text.
  const label = known?.label ?? status.replaceAll('_', ' ');
  const cls = known ? known.cls : 'b-grey';
  return <span className={cls ? `badge ${cls}` : 'badge'}>{label}</span>;
}
