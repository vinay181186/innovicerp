import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function SearchInput({ value, onChange, placeholder = 'Search this list…', width = 'var(--field-lg)', size = 'md', style }) {
  return <div className="gs-wrap" style={{ width, ...style }}>
    <span className="gs-icon"><Icon name="search" size={14} /></span>
    <input className="innovic-input" value={value} placeholder={placeholder} onChange={(e) => onChange && onChange(e.target.value)} style={{ width: '100%', paddingLeft: 28 }} />
  </div>;
}
