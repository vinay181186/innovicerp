import React from 'react';
export function Input({ className = '', ...rest }) {
  return <input className={('innovic-input ' + className).trim()} {...rest} />;
}
