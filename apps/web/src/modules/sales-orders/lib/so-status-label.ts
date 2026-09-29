// SO status → the words the user reads. The stored codes stay lower-case
// (packages/shared SO_STATUSES); only the display text is Title Case.
import type { SoStatus, SoType } from '@innovic/shared';

export const SO_STATUS_LABEL: Record<SoStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

/** For a status that arrives as a plain string (report rows). An unknown code
 *  falls back to the code itself with underscores turned into spaces. */
export function soStatusLabel(status: string): string {
  return SO_STATUS_LABEL[status as SoStatus] ?? status.replaceAll('_', ' ');
}

// SO type → the words the user reads (packages/shared SO_TYPES stays the code).
export const SO_TYPE_LABEL: Record<SoType, string> = {
  component_manufacturing: 'Component Manufacturing',
  equipment: 'Equipment',
  with_material: 'With Material',
};

/** For a type that arrives as a plain string. Unknown codes read as Title Case. */
export function soTypeLabel(type: string): string {
  return (
    SO_TYPE_LABEL[type as SoType] ??
    type.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
  );
}
