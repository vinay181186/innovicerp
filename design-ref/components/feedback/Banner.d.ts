import * as React from 'react';
/** Inline notice: warn (rework/recovery), ok (password changed), error, info. accent adds the 4px left bar used by the JC recovery banner. */
export interface BannerProps {
  tone?: 'warn' | 'ok' | 'error' | 'info';
  title?: React.ReactNode;
  children?: React.ReactNode;
  accent?: boolean;
  onDismiss?: () => void;
}
export declare function Banner(props: BannerProps): React.JSX.Element;
