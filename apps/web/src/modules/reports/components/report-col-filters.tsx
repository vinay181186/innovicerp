// The report's column filters (ADR-199 Phase 4): a strip ABOVE the grid with
// one small box per column on screen, in the grid's own left-to-right order.
// A column that is filtered keeps its box even after it moves into ▸ or is
// hidden, so an active filter can never become invisible.
import type { ReportColumn } from '@innovic/shared';

export interface ReportColFiltersProps {
  columns: ReportColumn[];
  /** Column keys on screen, left to right (from the grid's header). */
  visibleKeys: string[];
  numericKeys: ReadonlySet<string>;
  terms: Readonly<Record<string, string>>;
  onFilter: (key: string, value: string) => void;
}

export function ReportColFilters(props: ReportColFiltersProps): React.JSX.Element {
  const { columns, visibleKeys, numericKeys, terms, onFilter } = props;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const active = columns.filter(
    (c) => (terms[c.key] ?? '').trim() !== '' && !visibleKeys.includes(c.key),
  );
  const shown = [
    ...visibleKeys.flatMap((k) => {
      const c = byKey.get(k);
      return c ? [c] : [];
    }),
    ...active,
  ];
  return (
    <div className="rpt-colfilters" role="search" aria-label="Column filters">
      {shown.map((col) => (
        <label key={col.key} className="rpt-colfilter-item">
          <span className="rpt-colfilter-label">{col.label}</span>
          <input
            className="rpt-colfilter"
            value={terms[col.key] ?? ''}
            placeholder={numericKeys.has(col.key) ? '>0, <10, =5' : 'contains'}
            aria-label={`Filter ${col.label}`}
            onChange={(e) => onFilter(col.key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
