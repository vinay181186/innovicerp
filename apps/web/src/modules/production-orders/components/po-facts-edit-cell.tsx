// One editable cell of the Production Order fact grid (Edit page, mock-up
// frame 2): the same `.cl-fact` cell the detail page shows — label left,
// hairline on the left — with the CONTROL where the value sits.
//
// The pending-edit chip (ADR-202) is its own child after the control, exactly
// as ClusterFact's `after` is, so the control's box can never clip it
// (cluster-grid pitfall 2). When label + control + chip do not fit on one
// line the chip wraps onto a line of its own, right-aligned, and a chip wider
// than the whole cell breaks its own text (po-detail.css `.po-chip`).

import { cx } from '@/ui/forms/class-names';

export interface PoEditCellProps {
  label: React.ReactNode;
  /** id of the control inside, so clicking the label focuses it. */
  htmlFor?: string | undefined;
  /** Renders the ★ required marker after the label. */
  required?: boolean | undefined;
  /** Cells this field takes out of the row's four. */
  span?: 1 | 2 | undefined;
  /** The pending-change chip, when an edit to this field is waiting. */
  after?: React.ReactNode;
  /** Hover text for the cell (the pending value in full). */
  title?: string | undefined;
  className?: string | undefined;
  /** Extra class on the control's wrapper (`po-in-date`, `po-in-check`). */
  ctlClassName?: string | undefined;
  children: React.ReactNode;
}

export function PoEditCell({
  label,
  htmlFor,
  required = false,
  span = 1,
  after,
  title,
  className,
  ctlClassName,
  children,
}: PoEditCellProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'cl-fact',
        'po-in',
        span > 1 ? `cl-span-${span}` : undefined,
        after ? 'po-chip' : undefined,
        className,
      )}
      title={title}
    >
      {htmlFor ? (
        <label className="cl-fact-k" htmlFor={htmlFor}>
          {label}
          {required ? <span className="req">★</span> : null}
        </label>
      ) : (
        <span className="cl-fact-k">
          {label}
          {required ? <span className="req">★</span> : null}
        </span>
      )}
      <span className={cx('po-in-ctl', ctlClassName)}>{children}</span>
      {after ? <span className="cl-fact-after">{after}</span> : null}
    </div>
  );
}
