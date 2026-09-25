import React from 'react';
export function ProgressBar({ value = 0, color = 'var(--blue)', height = 6 }) {
  const v = Math.max(0, Math.min(100, value));
  return <div className="prog-wrap" style={{ height }}><div className="prog-bar" style={{ width: v + '%', background: color }} /></div>;
}
