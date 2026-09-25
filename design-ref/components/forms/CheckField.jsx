import React from 'react';
export function CheckField({ type = 'checkbox', label, checked, defaultChecked, onChange, name, disabled = false }) {
  return <label className="check-row" style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
    <input type={type} name={name} checked={checked} defaultChecked={defaultChecked} disabled={disabled} onChange={(e) => onChange && onChange(e.target.checked)} />
    <span>{label}</span>
  </label>;
}
