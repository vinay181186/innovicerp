import * as React from 'react';
/** Solid-colour toast that slides in from the right, bottom-right stack. */
export interface ToastProps {
  kind?: 'ok' | 'err' | 'info';
  children?: React.ReactNode;
}
export declare function Toast(props: ToastProps): React.JSX.Element;
export interface ToastStackProps { children?: React.ReactNode; }
export declare function ToastStack(props: ToastStackProps): React.JSX.Element;
