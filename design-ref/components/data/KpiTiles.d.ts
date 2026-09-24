import * as React from 'react';
export interface KpiTile { key: string; label: string; value: number | string; color: string; active?: boolean; }
/** @deprecated Renders StatStrip — use StatStrip directly. */
export interface KpiTilesProps { items: KpiTile[]; onSelect?: (key: string) => void; }
export declare function KpiTiles(props: KpiTilesProps): React.JSX.Element;
