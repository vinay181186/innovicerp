import * as React from 'react';
export interface QtyItem { label: string; value: React.ReactNode; color?: string; }
/** Compact bordered metric group on document cards: TOTAL QTY · JC QTY · LINES. */
export interface QtyStripProps { items: QtyItem[]; }
export declare function QtyStrip(props: QtyStripProps): React.JSX.Element;
/** @deprecated Same look as ReadField (form-label over 600 value) — use ReadField. */
export interface FactProps { label: string; value: React.ReactNode; color?: string; big?: boolean; }
export declare function Fact(props: FactProps): React.JSX.Element;
