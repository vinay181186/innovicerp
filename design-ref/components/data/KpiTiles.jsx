import React from 'react';
import { StatStrip } from './StatStrip.jsx';
export function KpiTiles({ items = [], onSelect }) {
  return <StatStrip items={items.map((t) => ({ key: t.key, label: t.label, count: t.value, color: t.color, active: t.active, onClick: onSelect ? () => onSelect(t.key) : undefined }))} />;
}
