import React from 'react';
import { StatStrip } from './StatStrip.jsx';
export function StatCard({ label, value, sub, accent = 'cyan' }) {
  return <StatStrip items={[{ key: label, label, count: value, sub, color: 'var(--' + accent + ')' }]} />;
}
