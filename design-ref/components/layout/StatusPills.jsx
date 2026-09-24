import React from 'react';
export function StatusPills({ options = [], value = null, onChange, allLabel = 'All', right }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {[null, ...options].map((o) => { const v = o == null ? null : (typeof o === 'string' ? o : o.value); const l = o == null ? allLabel : (typeof o === 'string' ? o.replace(/_/g, ' ') : o.label); const on = value === v;
        return <button key={v || 'all'} type="button" className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost')} style={{ fontSize: 'var(--fs-xs)', textTransform: 'capitalize', borderRadius: 999, padding: '4px 12px' }} onClick={() => onChange && onChange(v)}>{l}</button>; })}
    </div>
    {right ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{right}</div> : null}
  </div>;
}
export function ViewToggle({ value = 'list', onChange, expandAll, onExpandAll }) {
  return <>
    {onExpandAll ? <><button type="button" className="btn btn-ghost btn-sm" onClick={onExpandAll}>{expandAll ? 'Collapse all' : 'Expand all'}</button><span style={{ width: 1, height: 18, background: 'var(--border2)', margin: '0 4px' }} /></> : null}
    <button type="button" className={'btn btn-sm ' + (value === 'list' ? 'btn-primary' : 'btn-ghost')} aria-pressed={value === 'list'} onClick={() => onChange && onChange('list')}>☰ List View</button>
    <button type="button" className={'btn btn-sm ' + (value === 'card' ? 'btn-primary' : 'btn-ghost')} aria-pressed={value === 'card'} onClick={() => onChange && onChange('card')}>▦ Card View</button>
  </>;
}
