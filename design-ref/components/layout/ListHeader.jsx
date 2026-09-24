import React from 'react';
import { SearchInput } from '../forms/SearchInput.jsx';
export function ListHeader({ title, icon, count, noun = 'record', filterNote, search, onSearch, searchPlaceholder = 'Search this list…', updating = false, tools, primary, children, sticky = true }) {
  return <div style={sticky ? { position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)' } : { marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: children ? 8 : 0, gap: 8, flexWrap: 'wrap' }}>
      <div style={{ flexShrink: 0 }}>
        <div className="section-hdr" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>{icon ? icon + ' ' : ''}{title}</div>
        {count != null ? <div className="text3" style={{ fontSize: 'var(--fs-sm)', marginTop: 2 }}>{count} {noun}{count === 1 ? '' : 's'}{filterNote ? <> · <span className="text2">{filterNote}</span> only</> : null}</div> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {onSearch ? <SearchInput value={search} onChange={onSearch} placeholder={searchPlaceholder} /> : null}
        {tools}
        {updating ? <span className="text3" style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)' }}>⟳ Updating…</span> : null}
        {primary}
      </div>
    </div>
    {children}
  </div>;
}
