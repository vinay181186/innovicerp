import * as React from 'react';
export interface TimelineEvent { date: string; label: string; detail?: string; color?: string; icon?: string; code?: string; }
/** ONE timeline design (rail + coloured dots). regular = event cards (SO Timeline); compact = one-line events (Related Documents). */
export interface TimelineProps {
  events: TimelineEvent[];
  density?: 'regular' | 'compact';
  /** @deprecated use density */
  variant?: 'rail' | 'compact';
  title?: string;
}
export declare function Timeline(props: TimelineProps): React.JSX.Element;
