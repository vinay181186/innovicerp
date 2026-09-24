import React from 'react';
export function MachineCard({ code, name, running = false, jobCard, itemCode, operation, selected = false, onSelect }) {
  return <button type="button" onClick={onSelect} style={{ display: 'block', width: '100%', minWidth: 130, border: '2px solid ' + (selected ? 'var(--cyan)' : 'var(--border)'), borderRadius: 'var(--radius2)', background: selected ? 'var(--cyan3)' : 'var(--bg3)', padding: 12, textAlign: 'left', cursor: 'pointer', transition: 'all .15s', font: 'inherit', color: 'inherit' }}>
    <div className="mono cyan" style={{ fontWeight: 800, fontSize: 'var(--fs-sm)' }}>{code}</div>
    <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 4 }}>{name}</div>
    <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: running ? 'var(--green)' : 'var(--text3)' }}>{running ? '🟢 Running' : '⚪ Idle'}</div>
    {running ? <>
      <div className="mono text2" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>{jobCard}</div>
      {itemCode ? <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--purple)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemCode}</div> : null}
      <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>{operation}</div>
    </> : null}
  </button>;
}
