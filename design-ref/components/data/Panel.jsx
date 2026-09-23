import React from 'react';
export function Panel({ title, actions, children, bodyPadding = 12, style }) {
  return <div className="panel" style={style}>
    {title || actions ? <div className="panel-hdr"><h2 className="panel-title">{title}</h2>{actions ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{actions}</div> : null}</div> : null}
    <div style={{ padding: bodyPadding }}>{children}</div>
  </div>;
}
