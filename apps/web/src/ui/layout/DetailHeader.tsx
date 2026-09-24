// DetailHeader (+ ReadGrid, ReadField) — the top of every master / document
// detail page. 62 screens hand-roll the ← Back + panel-hdr pattern today and
// 21 of them re-declare their own read-only Pair()/DetailGrid() helper.
//
// Canonical detail page: DetailHeader(+ReadGrid) → Panels → RelatedDocs(+Timeline).
//
//   ← Back to Vendor Master              (ghost sm, arrow signals navigation)
//   ┌─ panel ────────────────────────────────────────────────────┐
//   │ VND-012  [Active]                         Edit · Print · Delete
//   │ Precision Heat Treat                                        │
//   ├─ panel-body: ReadGrid of ReadFields ───────────────────────┤
//
// ReadGrid is the SAME 12-column grid as FormGrid, and a ReadField takes the
// size that field has in its edit form — so a value sits in exactly the slot
// its input occupied, and view/edit stop shuffling the page. Every row of the
// grid must sum to 12.

import type { ReactNode } from 'react';
import { Icon } from '../core/Icon';

export interface DetailHeaderProps {
  /** "Back to Vendor Master" — name the list you return to, never just "Back". */
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  /** The document number / master code — mono, the main thing on the page. */
  code: string;
  /** Party or item name under the code. */
  name?: ReactNode | undefined;
  /** StatusBadge(s) beside the code. */
  badges?: ReactNode | undefined;
  /** Edit (ghost sm) · Print (ghost sm) · Delete (danger sm). */
  actions?: ReactNode | undefined;
  /** Panel body — usually a ReadGrid. */
  children?: ReactNode | undefined;
}

export function DetailHeader({
  backLabel = 'Back',
  onBack,
  code,
  name,
  badges,
  actions,
  children,
}: DetailHeaderProps): React.JSX.Element {
  return (
    <>
      {onBack ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 'var(--sp-2)' }}
          onClick={onBack}
        >
          <Icon name="arrow-left" size={14} /> {backLabel}
        </button>
      ) : null}
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                flexWrap: 'wrap',
              }}
            >
              <span
                className="td-code"
                style={{ color: 'var(--cyan)', fontSize: 'var(--fs-md)', fontWeight: 700 }}
              >
                {code}
              </span>
              {badges}
            </div>
            {name ? (
              <div className="panel-title" style={{ marginTop: 'var(--sp-1)' }}>
                {name}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
              {actions}
            </div>
          ) : null}
        </div>
        {children ? <div className="panel-body">{children}</div> : null}
      </div>
    </>
  );
}

export interface ReadGridProps {
  /** @deprecated legacy equal columns; omit for the canonical 12-column grid. */
  cols?: 2 | 3 | 4 | undefined;
  children?: ReactNode | undefined;
}

/** Read-only label/value grid — the same grid the edit form uses. */
export function ReadGrid({ cols, children }: ReadGridProps): React.JSX.Element {
  const cls =
    cols === 2
      ? 'form-grid'
      : cols === 3
        ? 'form-grid-3'
        : cols === 4
          ? 'form-grid-4'
          : 'form-grid-12';
  return <div className={cls}>{children}</div>;
}

export type ReadFieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

export interface ReadFieldProps {
  label: string;
  value?: ReactNode | undefined;
  /**
   * Same sizes as FormField — use the size this field has in its edit form:
   * xs %/rev/days/UOM · sm qty/rate/date/doc no. · md select/ref/code ·
   * lg party/name/email · full remarks/address.
   */
  size?: ReadFieldSize | undefined;
  /** Codes, doc numbers, dates and quantities render in --mono. */
  mono?: boolean | undefined;
  /** @deprecated use size="full" */
  full?: boolean | undefined;
  /** Keep the line breaks of a stored address / remark. */
  pre?: boolean | undefined;
}

/**
 * One header data field: 11px form-label over a 13/600 value. The value is
 * never truncated — it wraps — and an empty value renders an em dash in
 * --text3 so a blank field still reads as "asked and answered".
 */
export function ReadField({
  label,
  value,
  size,
  mono = false,
  full = false,
  pre = false,
}: ReadFieldProps): React.JSX.Element {
  const s: ReadFieldSize = size ?? (full ? 'full' : 'md');
  const empty = value == null || value === '';
  return (
    <div className={`form-grp f-${s}${full ? ' form-full' : ''}`}>
      <span className="form-label">{label}</span>
      <div
        className={mono && !empty ? 'mono' : undefined}
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          lineHeight: 1.35,
          color: empty ? 'var(--text3)' : 'var(--text)',
          whiteSpace: pre ? 'pre-wrap' : undefined,
          overflowWrap: 'break-word',
        }}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}
