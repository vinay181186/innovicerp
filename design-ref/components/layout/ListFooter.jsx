import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function ListFooter({ total = 0, shown, noun = 'record', limit, page, pageSize = 25, onPage, hint, actions }) {
  const plural = noun + (total === 1 ? '' : 's');
  const paged = page != null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const text = total === 0 ? 'No ' + noun + 's'
    : paged ? 'Showing ' + ((page - 1) * pageSize + 1) + '–' + Math.min(page * pageSize, total) + ' of ' + total
    : limit && total > limit ? 'Showing first ' + limit + ' of ' + total + ' — refine with search'
    : shown != null && shown !== total ? 'Showing ' + shown + ' of ' + total + ' ' + plural
    : 'Showing all ' + total + ' ' + plural;
  return <>
    <div style={{ display: 'flex', justifyContent: paged ? 'space-between' : 'flex-end', alignItems: 'center', marginTop: 8, fontSize: 'var(--fs-sm)', color: 'var(--text3)' }}>
      <span>{text}</span>
      {paged ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage && onPage(page - 1)}><span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><Icon name="chevron-right" size={14} /></span> Prev</button>
        <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>Page {page} / {pages}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage && onPage(page + 1)}>Next <Icon name="chevron-right" size={14} /></button>
      </div> : null}
    </div>
    {hint ? <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 4, padding: '0 4px' }}>💡 {hint}</div> : null}
    {actions ? <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>{actions}</div> : null}
  </>;
}
