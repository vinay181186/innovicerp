import React from 'react';
export function LineItemPicker({ code = '', name = '', items = [], onChange, readOnly = false, nameError }) {
  const id = React.useId();
  const match = items.find((it) => it.code.toUpperCase() === code.trim().toUpperCase());
  const locked = readOnly || Boolean(match);
  return <>
    <div className="form-grp f-md"><label className="form-label">Item Code</label>
      <input className="innovic-input" list={id} autoComplete="off" readOnly={readOnly} value={code}
        onChange={(e) => { const m = items.find((it) => it.code.toUpperCase() === e.target.value.trim().toUpperCase()); onChange && onChange({ code: e.target.value, name: m ? m.name : name, matched: Boolean(m) }); }} />
      <datalist id={id}>{items.map((it) => <option key={it.code} value={it.code}>{it.code} — {it.name}{it.material ? ' [' + it.material + ']' : ''}</option>)}</datalist>
    </div>
    <div className="form-grp f-lg"><label className="form-label">Item Name<span className="req">★</span></label>
      <input className={'innovic-input' + (match ? ' is-derived' : '')} readOnly={locked} value={match ? match.name : name}
        title={match ? 'Auto-filled from Item Master (item code is the key)' : undefined}
        onChange={(e) => onChange && onChange({ code, name: e.target.value, matched: false })} />
      {nameError ? <div className="form-error">{nameError}</div> : null}
    </div>
  </>;
}
