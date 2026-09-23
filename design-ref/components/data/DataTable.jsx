import React from 'react';
export function DataTable({ columns = [], rows = [], frozen = false, density = 'regular', editable = false, autoWidth = false, onRowClick, rowClassName, maxHeight, emptyText = 'No records', hint, variant }) {
  const legacy = variant === 'list';
  const cls = ['innovic-table', legacy ? '' : 'tbl-grid', density === 'compact' ? 'tbl-compact' : '', editable ? 'tbl-edit' : '', autoWidth ? 'tbl-auto' : ''].filter(Boolean).join(' ');
  return <><div className={'tbl-wrap' + (frozen ? ' tbl-frozen' : '')} style={{ ...(maxHeight ? { maxHeight } : null), ...(autoWidth || frozen ? null : { overflowX: 'hidden' }) }}>
    <table className={cls}>
      {!autoWidth && columns.some((c) => c.width) ? <colgroup>{columns.map((c, i) => <col key={i} style={{ width: c.width }} />)}</colgroup> : null}
      <thead><tr>{columns.map((c, i) => <th key={i} className={c.align === 'left' ? 'th-left' : c.align === 'right' ? 'th-right' : undefined} style={c.headColor ? { color: c.headColor } : undefined}>{c.header}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={columns.length} className="empty-state" style={{ padding: 24 }}>{emptyText}</td></tr> :
          rows.map((r, ri) => <tr key={r.id || ri} className={rowClassName ? rowClassName(r) : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
            {columns.map((c, ci) => <td key={ci} className={[c.className, c.align === 'left' ? 'td-left' : c.align === 'right' ? 'td-num' : ''].filter(Boolean).join(' ') || undefined}>{c.render ? c.render(r, ri) : r[c.key]}</td>)}
          </tr>)}
      </tbody>
    </table>
  </div>{hint ? <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 4, padding: '0 4px' }}>💡 {hint}</div> : null}</>;
}
