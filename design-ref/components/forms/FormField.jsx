import React from 'react';
const SIZE = { xs: 'f-xs', sm: 'f-sm', md: 'f-md', lg: 'f-lg', full: 'f-full' };
export function FormField({ label, required = false, help, error, size, span, children }) {
  // `span` is legacy (equal-column grids): 2 → lg, 'full' → full
  const s = size || (span === 'full' ? 'full' : span === 2 ? 'lg' : 'md');
  const cls = 'form-grp ' + SIZE[s] + (span === 'full' ? ' form-full' : span === 2 ? ' form-span-2' : '');
  return <div className={cls}>
    <label className="form-label">{label}{required ? <span className="req">★</span> : null}</label>
    {children}
    {error ? <div className="form-error">{error}</div> : help ? <div className="form-help">{help}</div> : null}
  </div>;
}
export function FormGrid({ cols, children, style }) {
  // Canonical: 12-column grid, fields sized by `size`. `cols` = legacy equal columns.
  const cls = cols === 2 ? 'form-grid' : cols === 3 ? 'form-grid-3' : cols === 4 ? 'form-grid-4' : 'form-grid-12';
  return <div className={cls} style={style}>{children}</div>;
}
