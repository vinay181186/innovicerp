import * as React from 'react';
/** @deprecated One-cell StatStrip. Use StatStrip. */
export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'cyan' | 'amber' | 'green' | 'red';
}
export declare function StatCard(props: StatCardProps): React.JSX.Element;
