import React from 'react';
export function Textarea({ className = '', rows = 3, ...rest }) {
  return <textarea rows={rows} className={('innovic-textarea ' + className).trim()} {...rest} />;
}
