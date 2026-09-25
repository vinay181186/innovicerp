import React from 'react';
export function Button({ variant = 'primary', size = 'md', icon, iconOnly = false, disabled = false, pill = false, children, className = '', style, ...rest }) {
  const cls = ['btn', 'btn-' + variant, size === 'sm' ? 'btn-sm' : '', iconOnly ? 'btn-icon' : '', className].filter(Boolean).join(' ');
  const s = pill ? { borderRadius: 999, padding: '4px 12px', fontSize: 'var(--fs-xs)', ...style } : style;
  return <button type="button" className={cls} disabled={disabled} style={s} {...rest}>{icon}{children}</button>;
}
