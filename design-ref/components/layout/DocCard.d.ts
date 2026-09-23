import * as React from 'react';
/**
 * Document card (Card View of SO / GRN / PR / DC lists): 4px accent bar, identity band (▸ code · party · badges · actions), metric band (QtyStrip + mono · meta line), expandable bg3 lines band.
 * @startingPoint section="Layout" subtitle="Expandable document card" viewport="900x260"
 */
export interface DocCardProps {
  /** red = late, green = finished/cleared, amber = waiting on QC, blue = open */
  accent?: string;
  expanded?: boolean;
  onToggle?: () => void;
  code: string;
  /** Code click opens the detail page */
  onOpen?: () => void;
  /** Party name (customer / vendor) */
  title?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  /** Usually <QtyStrip/> */
  metrics?: React.ReactNode;
  /** Mono meta items joined by " · " */
  meta?: React.ReactNode[];
  /** Expanded content — usually <LinesPanel/> */
  children?: React.ReactNode;
}
export declare function DocCard(props: DocCardProps): React.JSX.Element;
/** "▸ LINE ITEMS — CODE  Open full detail →" band with a nested table as children. */
export interface LinesPanelProps { title?: string; code: string; onOpenDetail?: () => void; children?: React.ReactNode; }
export declare function LinesPanel(props: LinesPanelProps): React.JSX.Element;
