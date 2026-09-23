import React from 'react';
export function Select({ options = [], className = '', children, ...rest }) {
  return <select className={('innovic-select ' + className).trim()} {...rest}>
    {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    {children}
  </select>;
}
