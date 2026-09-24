import * as React from 'react';
/** 7px connection-status dot from the header. */
export interface SyncDotProps {
  state?: 'ok' | 'offline' | 'error';
  /** Optional mono caption, e.g. SYNCED */
  label?: string;
}
export declare function SyncDot(props: SyncDotProps): React.JSX.Element;
