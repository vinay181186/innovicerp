// ReportShell — the ONE layout every report screen is built on (ERPNext gap
// report 2026-09-26). Before this each report hand-rolled its own filter bar
// (a panel + form-grid-3 on the runner, inline flex rows elsewhere) and its own
// export buttons under four different labels.
//
// ERPNext's report layout, which this mirrors:
//
//   ← Back to Reports
//   📊 Report title                                   [extra]  [Export ▾]
//   one quiet subtitle line
//   ───────────────────────────────────────────────────────────── (sticky)
//   [Field][Field][Field][Field]                    [Apply] [Clear]
//   ┌ KPI strip (optional) ┐
//   ┌ table — sticky header, right-aligned numbers, bold totals row ┐
//   Showing all N rows                                  (or the page's footer)
//
// The table itself is the page's `children` (a `.tbl-wrap > .innovic-table`),
// because every report's cells differ. Numeric columns carry `th-num` /
// `td-num`; a totals row sits in <tfoot> using `ReportTotalRow` below.
//
// Not re-exported from ui/data/index.ts on purpose (that file is frozen for
// this change); import it by path: `@/ui/data/ReportShell`.

import type { FormEvent, ReactNode } from 'react';
import { ActionMenu } from '../layout/ActionMenu';
import { ListFooter } from '../layout/ListFooter';
import { PageHeader } from '../layout/PageHeader';

export interface ReportExport {
  csv?: (() => void) | undefined;
  excel?: (() => void) | undefined;
  /** The export is being prepared (server download in flight). */
  busy?: boolean | undefined;
}

export interface ReportShellProps {
  title: string;
  /** Module emoji from the nav — identity only. */
  icon?: string | undefined;
  subtitle?: ReactNode | undefined;
  /** "Back to Reports" — name where you return, never just "Back". */
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  /** Filter fields (use <ReportFilter>) — laid out in ONE wrapping row. */
  filters?: ReactNode | undefined;
  /** Given → the filter row is a form: Enter / Apply submits. Omit when the
   *  fields apply instantly (client-side filters). */
  onApply?: (() => void) | undefined;
  onClear?: (() => void) | undefined;
  /** Apply is busy (the report is re-running). */
  applying?: boolean | undefined;
  /** ONE "Export ▾" menu with CSV / Excel — never separate buttons. */
  onExport?: ReportExport | undefined;
  /** Nothing to export yet (no rows) — the menu items are disabled. */
  exportDisabled?: boolean | undefined;
  /** Extra page actions left of Export (e.g. Print). */
  actions?: ReactNode | undefined;
  /** Optional StatStrip above the table. */
  kpis?: ReactNode | undefined;
  /** Rows on screen — renders "Showing all N rows" under the table. */
  rowCount?: number | undefined;
  /** Singular noun for the count line ("row", "item", "SO"). */
  rowNoun?: string | undefined;
  /** Replaces the default count line (e.g. a ListFooter in pager mode). */
  footer?: ReactNode | undefined;
  children: ReactNode;
}

export function ReportShell({
  title,
  icon,
  subtitle,
  backLabel,
  onBack,
  filters,
  onApply,
  onClear,
  applying = false,
  onExport,
  exportDisabled = false,
  actions,
  kpis,
  rowCount,
  rowNoun = 'row',
  footer,
  children,
}: ReportShellProps): React.JSX.Element {
  const exportItems = onExport
    ? [
        ...(onExport.csv
          ? [{ label: 'CSV', onClick: onExport.csv, disabled: exportDisabled || onExport.busy }]
          : []),
        ...(onExport.excel
          ? [
              {
                label: 'Excel',
                onClick: onExport.excel,
                disabled: exportDisabled || onExport.busy,
                title: onExport.busy ? 'Preparing the Excel file…' : undefined,
              },
            ]
          : []),
      ]
    : [];

  const headerActions =
    actions || exportItems.length > 0 ? (
      <>
        {actions}
        {exportItems.length > 0 ? (
          <ActionMenu label={onExport?.busy ? 'Exporting…' : 'Export'} items={exportItems} />
        ) : null}
      </>
    ) : undefined;

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 'var(--sp-2)',
  };

  const buttons =
    onApply || onClear ? (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
        {onApply ? (
          <button type="submit" className="btn btn-primary" disabled={applying}>
            {applying ? 'Applying…' : 'Apply'}
          </button>
        ) : null}
        {onClear ? (
          <button type="button" className="btn btn-ghost" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
    ) : null;

  const filterRow = filters ? (
    onApply ? (
      <form
        style={rowStyle}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onApply();
        }}
      >
        {filters}
        {buttons}
      </form>
    ) : (
      <div style={rowStyle}>
        {filters}
        {buttons}
      </div>
    )
  ) : null;

  return (
    <div>
      <PageHeader
        sticky
        title={title}
        icon={icon}
        subtitle={subtitle}
        backLabel={backLabel}
        onBack={onBack}
        actions={headerActions}
      >
        {filterRow}
      </PageHeader>
      {kpis ? <div style={{ marginBottom: 'var(--sp-2)' }}>{kpis}</div> : null}
      {children}
      {footer ?? (rowCount != null ? <ListFooter total={rowCount} noun={rowNoun} /> : null)}
    </div>
  );
}

export interface ReportFilterProps {
  label: string;
  /** Ties the label to its control. */
  htmlFor?: string | undefined;
  /** Field width token: md (144px, dates / selects) is the ERPNext col-md-2
   *  equivalent; lg (224px) for search boxes and long selects. */
  size?: 'sm' | 'md' | 'lg' | undefined;
  children: ReactNode;
}

/** One labelled field in the report filter row. The control inside keeps its
 *  own `.innovic-input` / `.innovic-select` class (28px, --control-h). */
export function ReportFilter({
  label,
  htmlFor,
  size = 'md',
  children,
}: ReportFilterProps): React.JSX.Element {
  return (
    <div className={`fw-${size}`} style={{ display: 'flex', flexDirection: 'column' }}>
      <label className="form-label" htmlFor={htmlFor} style={{ marginBottom: 'var(--sp-1)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** The bold totals row's cell style — put on the <tr> inside <tfoot>. */
export const reportTotalRowStyle: React.CSSProperties = {
  fontWeight: 700,
  background: 'var(--bg4)',
  borderTop: '2px solid var(--border)',
};
