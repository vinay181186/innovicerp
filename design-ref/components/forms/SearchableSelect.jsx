import React from 'react';
export function SearchableSelect({ value = null, onChange, options = [], placeholder = '🔍 Click to browse or type to search…', disabled = false, emptyText = 'No matches', loading = false, style }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [hl, setHl] = React.useState(0);
  const ref = React.useRef(null);
  const label = (o) => (o.code ? o.code + ' — ' + o.name : o.name);
  React.useEffect(() => { const sel = options.find((o) => o.id === value); if (sel && !open) setQ(label(sel)); }, [value]);
  React.useEffect(() => { const d = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', d, true); return () => document.removeEventListener('mousedown', d, true); }, []);
  const f = options.filter((o) => !q || label(o).toLowerCase().includes(q.toLowerCase()) || (value && label(o) === q));
  const pick = (o) => { onChange && onChange(o.id); setQ(label(o)); setOpen(false); };
  return <div ref={ref} style={{ position: 'relative', ...style }}>
    <input className="innovic-input" role="combobox" aria-expanded={open} autoComplete="off" disabled={disabled} placeholder={placeholder} value={q}
      onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); if (value && onChange) onChange(null); }}
      onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, f.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); } else if (e.key === 'Enter' && open && f[hl]) { e.preventDefault(); pick(f[hl]); } else if (e.key === 'Escape') setOpen(false); }} />
    {open ? <ul className="ss-list" role="listbox">
      {loading ? <li className="ss-muted">Loading…</li> : f.length === 0 ? <li className="ss-muted">{emptyText}</li> :
        f.map((o, i) => <li key={o.id} role="option" aria-selected={o.id === value} className={'ss-opt' + (i === hl ? ' hl' : '')} onMouseEnter={() => setHl(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
          {o.code ? <><b>{o.code}</b><span style={{ opacity: i === hl ? 0.8 : 1, color: i === hl ? undefined : 'var(--text3)' }}> — {o.name}</span></> : o.name}
        </li>)}
    </ul> : null}
  </div>;
}
