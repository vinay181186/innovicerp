import * as React from 'react';
/** Status filter as pill buttons (active = btn-primary pill) with an optional right cluster. */
export interface StatusPillsProps {
  /** Enum values (underscores render as spaces) or {value,label} */
  options: Array<string | { value: string; label: string }>;
  /** null = All */
  value?: string | null;
  onChange?: (v: string | null) => void;
  allLabel?: string;
  /** Right side — usually <ViewToggle/> */
  right?: React.ReactNode;
}
export declare function StatusPills(props: StatusPillsProps): React.JSX.Element;
/** Expand all / Collapse all + ☰ List View / ▦ Card View toggle. */
export interface ViewToggleProps { value?: 'list' | 'card'; onChange?: (v: 'list' | 'card') => void; expandAll?: boolean; onExpandAll?: () => void; }
export declare function ViewToggle(props: ViewToggleProps): React.JSX.Element;
