import React from 'react';
export function Toast({ kind = 'ok', children }) {
  return <div className={'toast-item toast-' + kind} role="status">{children}</div>;
}
export function ToastStack({ children }) {
  return <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;
}
