import * as React from 'react';
/** Centered 40px-padded muted message for empty lists / loading / errors. */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  tone?: 'muted' | 'ok' | 'error';
  children?: React.ReactNode;
}
export declare function EmptyState(props: EmptyStateProps): React.JSX.Element;
