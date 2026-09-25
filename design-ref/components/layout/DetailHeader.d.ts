import * as React from 'react';
/**
 * Detail page top: ← Back ghost button, then a panel whose header holds the mono code (cyan 16/700) + badges over the Barlow Condensed name, actions right.
 * @startingPoint section="Layout" subtitle="Record detail header + read-only field grid" viewport="900x320"
 */
export interface DetailHeaderProps {
  /** "Back to Vendor Master" */
  backLabel?: string;
  onBack?: () => void;
  code: string;
  name?: React.ReactNode;
  badges?: React.ReactNode;
  /** Edit (ghost sm) · Print (ghost sm) · Delete (danger sm) */
  actions?: React.ReactNode;
  /** Body — usually a ReadGrid */
  children?: React.ReactNode;
}
export declare function DetailHeader(props: DetailHeaderProps): React.JSX.Element;
/** Read-only label/value grid — same grid as the edit form so fields sit in identical places. */
export interface ReadGridProps {
  /** @deprecated equal columns; omit for the canonical 12-col grid (same as FormGrid) */
  cols?: 2 | 3 | 4;
  children?: React.ReactNode;
}
export declare function ReadGrid(props: ReadGridProps): React.JSX.Element;
/** Header data field: 11px form-label over a 13/600 value; never truncated (wraps); empty renders "—" in --text3. */
export interface ReadFieldProps {
  label: string;
  value?: React.ReactNode;
  /** Same sizes as FormField — use the size the field has in its edit form. Default 'md'. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'full';
  /** Codes, doc numbers, dates, quantities render in --mono */
  mono?: boolean;
  /** @deprecated use size="full" */
  full?: boolean;
  pre?: boolean;
}
export declare function ReadField(props: ReadFieldProps): React.JSX.Element;
