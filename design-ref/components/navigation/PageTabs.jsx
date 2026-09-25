import React from 'react';
export function PageTabs({ tabs = [], activeKey, onSelect, onClose }) {
  return <div className="pagetabs">
    {tabs.map((t) => <div key={t.key} className={'pgtab' + (t.key === activeKey ? ' active' : '')} onClick={() => onSelect && onSelect(t.key)} title={t.label}>
      <span>{t.icon}</span><span className="pgtab-label">{t.label}</span>
      <button type="button" className="pgtab-close" aria-label={'Close ' + t.label} onClick={(e) => { e.stopPropagation(); onClose && onClose(t.key); }}>×</button>
    </div>)}
  </div>;
}
