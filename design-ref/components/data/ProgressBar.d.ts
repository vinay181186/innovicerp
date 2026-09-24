import * as React from 'react';
/** 6px progress track on bg5, 4px radius. */
export interface ProgressBarProps {
  /** 0-100 */
  value: number;
  /** Fill token, e.g. var(--green) */
  color?: string;
  height?: number;
}
export declare function ProgressBar(props: ProgressBarProps): React.JSX.Element;
