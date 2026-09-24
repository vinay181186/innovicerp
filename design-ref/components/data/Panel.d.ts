import * as React from 'react';
/**
 * The standard Innovic container: white, 1px border, 8px radius, NO shadow, bg3 header band.
 * @startingPoint section="Data" subtitle="Panel with header + actions" viewport="700x240"
 */
export interface PanelProps {
  /** Barlow Condensed 16px title */
  title?: React.ReactNode;
  /** Right side of the header — usually small buttons or a badge */
  actions?: React.ReactNode;
  /** Body padding (default 12). Use 0 for full-bleed tables. */
  bodyPadding?: number | string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Panel(props: PanelProps): React.JSX.Element;
