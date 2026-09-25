import React from 'react';
import { SearchInput } from '../forms/SearchInput.jsx';
export function FilterBar({ search, onSearch, placeholder = 'Search this list…', filters = [] }) {
  return <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) repeat(auto-fit, minmax(140px, 1fr))', gap: 8, padding: 8, marginBottom: 8 }}>
    <SearchInput value={search} onChange={onSearch} placeholder={placeholder} width="100%" />
    {filters.map((f) => <select key={f.key} className="innovic-select" value={f.value} onChange={(e) => f.onChange && f.onChange(e.target.value)} style={{ fontSize: 'var(--fs-sm)', minWidth: 0, height: 32, padding: '4px 8px' }}>
      {f.options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>)}
  </div>;
}
