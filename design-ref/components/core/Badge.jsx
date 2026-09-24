import React from 'react';
export function Badge({ tone = 'grey', children, style }) {
  return <span className={'badge b-' + tone} style={style}>{children}</span>;
}
