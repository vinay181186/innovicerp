import * as React from 'react';
/** Mono 11px uppercase status chip on a pale wash, 4px radius. */
export interface BadgeProps {
  tone?: 'green' | 'amber' | 'blue' | 'red' | 'grey' | 'cyan' | 'orange' | 'teal' | 'purple';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): React.JSX.Element;
