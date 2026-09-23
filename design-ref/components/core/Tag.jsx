import React from 'react';
const TONES = { link: ['var(--blue)', 'var(--blue3)'], neutral: ['var(--text2)', 'var(--bg4)'], rev: ['var(--purple2)', 'var(--purple3)'] };
export function Tag({ tone = 'link', color, bg, children, onClick }) {
  const [c, b] = TONES[tone] || TONES.link;
  return <span className="tag" onClick={onClick} style={{ color: color || c, background: bg || b, cursor: onClick ? 'pointer' : undefined }}>{children}</span>;
}
