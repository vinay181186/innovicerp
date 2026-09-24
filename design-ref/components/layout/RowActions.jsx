import React from 'react';
import { Icon } from '../core/Icon.jsx';
const ICONS = { view: <Icon name="eye" size={13} />, edit: <Icon name="pencil" size={13} />, delete: <Icon name="trash-2" size={13} /> };
export function RowActions({ onView, onEdit, onDelete, extra, labelled = false }) {
  const b = (kind, title, fn) => fn ? <button type="button" title={title} aria-label={title}
    className={'btn btn-sm ' + (kind === 'delete' ? 'btn-danger' : 'btn-ghost') + (labelled ? '' : ' btn-icon')}
    style={labelled ? undefined : { padding: '4px 4px', ...(kind === 'delete' ? { color: 'var(--red)', background: 'var(--bg2)', borderColor: 'var(--border3)' } : null) }}
    onClick={(e) => { e.stopPropagation(); fn(); }}>{labelled ? (kind === 'delete' ? 'Del' : kind === 'edit' ? 'Edit' : 'View') : ICONS[kind]}</button> : null;
  return <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
    {b('view', 'View', onView)}{b('edit', 'Edit', onEdit)}{extra}{b('delete', 'Delete', onDelete)}
  </div>;
}
