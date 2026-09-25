// DocCard (+ LinesPanel) — the Card View row of every document list (SO, GRN,
// PR, DC, JWSO, JC). 13 files hand-roll this same anatomy today, each with its
// own accentFor() and its own QtyBox copy.
//
//   ┃ ▸ IN-GRN-26-0142  Precision Heat Treat  [QC Pending]      [Assign]
//   ┃ Received 60 · Accepted 0 · Rejected 0   2026-09-23 · PO … · DC 4471
//   ┃ ┌ expanded (bg3) ─────────────────────────────────────────────────┐
//   ┃ │ ▸ LINE ITEMS — IN-GRN-26-0142      Open full detail →            │
//   ┃ │ nested .tbl-compact table                                        │
//
// The 4px left bar carries the document's state: blue open · red late ·
// green finished/cleared · amber waiting on QC. Clicking the card toggles the
// lines; clicking the code opens the detail page; the actions cluster stops the
// toggle from firing. The expanded band carries no click of its own, so a
// LinesPanel placed inside some other clickable surface still works there.

import { Fragment, type ReactNode } from 'react';
import { Icon } from '../core/Icon';

export interface DocCardProps {
  /** Token colour for the state bar: blue open · red late · green done · amber QC. */
  accent?: string | undefined;
  expanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  /** The document number — mono, bold, the main thing on the card. */
  code: string;
  /** Opens the detail page from the code. */
  onOpen?: (() => void) | undefined;
  /** Party name (customer / vendor). */
  title?: ReactNode | undefined;
  badges?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** Usually a QtyStrip. */
  metrics?: ReactNode | undefined;
  /** Mono metadata, joined with " · ". */
  meta?: ReactNode[] | undefined;
  /** Expanded content — usually a LinesPanel. */
  children?: ReactNode | undefined;
}

export function DocCard({
  accent = 'var(--blue)',
  expanded = false,
  onToggle,
  code,
  onOpen,
  title,
  badges,
  actions,
  metrics,
  meta = [],
  children,
}: DocCardProps): React.JSX.Element {
  const bandCursor = onToggle ? 'pointer' : 'default';
  return (
    <div className="panel" style={{ display: 'flex', padding: 0, marginBottom: 'var(--sp-2)' }}>
      {/* 4px state bar — a graphic rule, like the sheet table's 2px blue rules. */}
      <div style={{ width: 4, flexShrink: 0, background: accent }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            padding: 'var(--sp-2) var(--sp-3)',
            cursor: bandCursor,
          }}
        >
          {onToggle ? (
            <span style={{ color: 'var(--text3)', display: 'inline-flex' }}>
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
            </span>
          ) : null}
          <span
            className="td-code"
            style={{
              color: 'var(--blue)',
              fontWeight: 800,
              fontSize: 'var(--fs-sm)',
              cursor: onOpen ? 'pointer' : undefined,
            }}
            onClick={
              onOpen
                ? (e): void => {
                    e.stopPropagation();
                    onOpen();
                  }
                : undefined
            }
          >
            {code}
          </span>
          {title ? (
            <span className="fw-700" style={{ fontSize: 'var(--fs-sm)' }}>
              {title}
            </span>
          ) : null}
          {badges}
          <span style={{ flex: 1 }} />
          {actions ? (
            <div
              style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          ) : null}
        </div>
        {metrics || meta.length ? (
          <div
            onClick={onToggle}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              padding: '0 var(--sp-3) var(--sp-2)',
              cursor: bandCursor,
            }}
          >
            {metrics}
            <div
              className="mono"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--text3)',
                display: 'flex',
                gap: 'var(--sp-1)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              {meta.map((m, i) => (
                <Fragment key={i}>
                  {i ? <span>·</span> : null}
                  <span style={{ whiteSpace: 'nowrap' }}>{m}</span>
                </Fragment>
              ))}
            </div>
          </div>
        ) : null}
        {expanded && children ? (
          <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface LinesPanelProps {
  /** "LINE ITEMS" / "LINES" / "OPERATIONS" — the band label. */
  title?: string | undefined;
  /** The parent document number, repeated so the band names what it belongs to. */
  code: string;
  onOpenDetail?: (() => void) | undefined;
  /** The nested .tbl-compact table. */
  children?: ReactNode | undefined;
}

/** "▸ LINE ITEMS — CODE   Open full detail →" band with the nested table under it. */
export function LinesPanel({
  title = 'LINE ITEMS',
  code,
  onOpenDetail,
  children,
}: LinesPanelProps): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-2) var(--sp-6)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-1)',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--blue)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
          }}
        >
          ▸ {title} — {code}
        </div>
        {onOpenDetail ? (
          <button
            type="button"
            // A quiet text link, not a control: the reference renders a bare
            // <a> here, and a ghost button's border box would out-shout the
            // mono "▸ LINE ITEMS — CODE" label it sits beside. A real <button>
            // is kept for the keyboard; only the chrome goes.
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              margin: 0,
              font: 'inherit',
              fontSize: 'var(--fs-xs)',
              color: 'var(--blue)',
              cursor: 'pointer',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail();
            }}
          >
            Open full detail →
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
