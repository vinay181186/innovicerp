import * as React from 'react';
/** Click-to-sort column label; cycles asc → desc → none. ↕ at 30% when idle, ▲/▼ blue when active. */
export interface SortHeaderProps {
  label: string;
  active?: boolean;
  dir?: 'asc' | 'desc';
  onSort?: () => void;
}
export declare function SortHeader(props: SortHeaderProps): React.JSX.Element;
