// ClusterGrid — the create / edit / view layout agreed on the Plan screens
// (plan-modals-mockup.html, 2026-10-03), as a primitive.
//
//   <DocIdent>     WHICH document / line this is (codes, SO line, POL). Those
//                  are not facts about the document, so they sit above the grid.
//   <ClusterGrid>  the stack of clusters, ruled off from each other.
//   <Cluster>      ONE row of four equal cells, its name in a left gutter. Wide
//                  content says so with `cl-span-2/3/4` on its cell — every row
//                  must come out full (four cells), never two columns of
//                  different heights.
//   <ClusterFact>  a read-only fact on ONE line: label left, value right.
//                  `lead` marks the RESULT a row adds up to — it sits last and
//                  carries the 3px green rule.
//
// Create, Edit and View of one document use the same clusters in the same
// order; only the controls differ (FormField on a form, ClusterFact on a view).
// A FormField dropped into a Cluster ignores its 12-column `size` — the
// cluster's own span classes decide its width.

import type { ReactNode } from 'react';
import { cx } from './class-names';
import './cluster-grid.css';

export function DocIdent({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className="cl-ident">{children}</div>;
}

/** A code inside the identity line (SO No., CODE/REV, JC No.). */
export function IdentCode({ children }: { children?: ReactNode }): React.JSX.Element {
  return <span className="cl-ident-code">{children}</span>;
}

/** The quiet `·` between identity-line parts. */
export function IdentSep(): React.JSX.Element {
  return (
    <span className="cl-ident-sep" aria-hidden="true">
      ·
    </span>
  );
}

export function ClusterGrid({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className="cl-grid">{children}</div>;
}

export interface ClusterProps {
  /** The cluster's name, shown in the left gutter (Quantity, Schedule, …).
   *
   *  `null` continues the cluster above: the gutter COLUMN is kept, so this
   *  row's cells stay in the same four tracks, but it carries no second word.
   *  A cluster with more facts than fit one row needs this — dropping the
   *  gutter instead shifts every cell 104px left of the row above it.
   *
   *  `undefined` drops the gutter entirely and the four cells take the full
   *  width. That is for a screen whose grid is ONE row, with nothing to tell
   *  it apart from (the Create / Edit modals); inventing a name per row of a
   *  single continuous form just adds words. */
  name?: ReactNode | null;
  children?: ReactNode;
}

export function Cluster({ name, children }: ClusterProps): React.JSX.Element {
  if (name === undefined) {
    return <div className="cl-row cl-nogut">{children}</div>;
  }
  return (
    <div className="cl-row" role="group" aria-label={typeof name === 'string' ? name : undefined}>
      <span className="cl-gut" aria-hidden={name === null ? true : undefined}>
        {name}
      </span>
      {children}
    </div>
  );
}

export interface ClusterFactProps {
  label: ReactNode;
  value: ReactNode;
  /** Cells this fact takes out of the row's four. Default 1. */
  span?: 1 | 2 | 3 | 4;
  /** The result the row adds up to — green rule, green value. */
  lead?: boolean;
  /** Mono, tabular digits — quantities, money, dates, codes. */
  num?: boolean;
  /** Free text (remarks) — wraps over lines, reads left to right. */
  wrap?: boolean;
  /** Grey "—" styling for a value that is not there. */
  empty?: boolean;
  /** Full value on hover — a one-line cell may ellipsis a long name. */
  title?: string | undefined;
  /** Shown after the value (ADR-202 pending-change chip). Rendered as its own
   *  cell child, NOT inside the value: the value is one clipped line, so a chip
   *  in there is the first thing an ellipsis eats. */
  after?: ReactNode;
  className?: string;
}

export function ClusterFact({
  label,
  value,
  span = 1,
  lead = false,
  num = false,
  wrap = false,
  empty = false,
  title,
  after,
  className,
}: ClusterFactProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'cl-fact',
        span > 1 ? `cl-span-${span}` : undefined,
        lead ? 'cl-lead' : undefined,
        wrap ? 'is-wrap' : undefined,
        className,
      )}
      title={title}
    >
      <span className="cl-fact-k">{label}</span>
      <span className={cx('cl-fact-v', num ? 'is-num' : undefined, empty ? 'is-empty' : undefined)}>
        {value}
      </span>
      {after ? <span className="cl-fact-after">{after}</span> : null}
    </div>
  );
}
