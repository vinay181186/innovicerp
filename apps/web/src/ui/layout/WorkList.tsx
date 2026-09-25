// WorkList (+ AttentionList, StatRow, QuickLinks) — the dashboard building
// blocks, promoted out of modules/dashboard so every home variant and every
// module landing page composes the same four shapes.
//
// Colours come only from --sig-* (severity) and --dept-* (quick links); nothing
// here invents a colour. Every row that navigates is a real link when the caller
// passes `renderLink` — middle-click and ctrl-click must keep working.

import type { CSSProperties, ReactNode } from 'react';
import { LinkSlot, type RenderLink } from './link-slot';

export type Severity = 'critical' | 'warn' | 'info';

const SEV: Record<Severity, string> = {
  critical: 'var(--sig-critical)',
  warn: 'var(--sig-warn)',
  info: 'var(--sig-info)',
};

/** Read aloud in place of the colour, which carries the severity on screen. */
const SEV_SPOKEN: Record<Severity, string> = {
  critical: 'Critical',
  warn: 'Warning',
  info: 'Information',
};

// Off-screen but still announced. The app's own stylesheet declares no
// .sr-only, and a Tailwind utility may not be used inside ui/ — so the
// visually-hidden box is spelled out here.
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface WorkItem {
  /** Stable key — the work item's own id, not the array index. */
  key?: string | undefined;
  severity?: Severity | undefined;
  /** Module emoji: ⚠️ 📄 🔬 */
  icon?: string | undefined;
  /** "NC-0214 awaiting disposition" — name the document. */
  title: string;
  /** "JC-0917 · Pinion Shaft · 4 pcs" — metadata joined with " · ". */
  detail?: ReactNode | undefined;
  /** Days old; 0 shows "·" and reads as "Today". */
  age?: number | undefined;
  /** Verb-first: "Dispose", "Approve", "Inspect" — the arrow is added. */
  action: string;
  onAction?: (() => void) | undefined;
  /** Route for the action button; with `renderLink` it becomes a real link. */
  actionTo?: string | undefined;
}

export interface WorkListProps {
  title?: string | undefined;
  items: WorkItem[];
  emptyText?: string | undefined;
  /** "3 more items · Show all →" footer. */
  more?: { label: string; onClick?: (() => void) | undefined } | undefined;
  renderLink?: RenderLink | undefined;
}

export function WorkList({
  title = '📋 My Work',
  items,
  emptyText = "✅ You're all caught up — no pending work.",
  more,
  renderLink,
}: WorkListProps): React.JSX.Element {
  const critical = items.filter((i) => i.severity === 'critical').length;
  return (
    <div className="panel" style={{ marginBottom: 'var(--sp-3)' }}>
      <div className="panel-hdr">
        <span className="panel-title">{title}</span>
        {items.length ? (
          <span
            className="badge"
            style={
              critical
                ? { background: 'var(--sig-critical-bg)', color: 'var(--sig-critical)' }
                : undefined
            }
          >
            {critical
              ? `${critical} critical · ${items.length} total`
              : `${items.length} item${items.length > 1 ? 's' : ''}`}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div style={{ padding: 'var(--sp-4)', color: 'var(--sig-ok)', fontWeight: 600 }}>
          {emptyText}
        </div>
      ) : (
        items.map((it, i) => {
          const sev = it.severity ?? 'info';
          const btnCls =
            sev === 'critical' ? 'btn-danger' : sev === 'warn' ? 'btn-primary' : 'btn-ghost';
          const actionLabel = `${it.action} →`;
          const aged = it.age != null && it.age > 0;
          return (
            <div
              key={it.key ?? i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                padding: 'var(--sp-2)',
                borderBottom: '1px solid var(--border)',
                // 3px severity rail — a graphic rule, not a spacing step.
                borderLeft: `3px solid ${SEV[sev]}`,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 'var(--fs-sm)' }}>
                {it.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{it.title}</div>
                <div
                  style={{
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--text3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.detail}
                </div>
              </div>
              {/* "5d" is meaningless read aloud and the severity is colour-only —
                  both fixed by naming them. */}
              <span
                title={aged ? `${it.age} days old` : 'Today'}
                style={{
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 700,
                  // A fixed 36px column, like the 3px rail above: it exists so
                  // the action buttons line up down the right edge whether the
                  // row says "·", "5d" or "120d". Not a spacing step, and not a
                  // field width — min-width would let the column breathe and
                  // break the rhythm it is there to create.
                  width: 36,
                  textAlign: 'right',
                  color: sev === 'critical' ? 'var(--sig-critical)' : 'var(--text3)',
                }}
              >
                <span style={VISUALLY_HIDDEN}>{SEV_SPOKEN[sev]}, </span>
                {aged ? `${it.age}d` : '·'}
              </span>
              {it.actionTo ? (
                <LinkSlot
                  to={it.actionTo}
                  renderLink={renderLink}
                  className={`btn ${btnCls} btn-sm`}
                  style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap', width: 'auto' }}
                >
                  {actionLabel}
                </LinkSlot>
              ) : (
                <button
                  type="button"
                  className={`btn ${btnCls} btn-sm`}
                  style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
                  onClick={it.onAction}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          );
        })
      )}
      {more ? (
        <div
          style={{
            padding: 'var(--sp-2) var(--sp-3)',
            cursor: 'pointer',
            fontSize: 'var(--fs-sm)',
            color: 'var(--cyan)',
          }}
          onClick={more.onClick}
        >
          📋 {more.label}
        </div>
      ) : null}
    </div>
  );
}

export interface AttentionItem {
  key?: string | undefined;
  icon?: string | undefined;
  /** "2 SOs overdue" — the count and the thing, nothing else. */
  label: string;
  severity?: Severity | undefined;
  onClick?: (() => void) | undefined;
  to?: string | undefined;
}

export interface AttentionListProps {
  items: AttentionItem[];
  emptyText?: string | undefined;
  renderLink?: RenderLink | undefined;
}

/** "Needs Attention" rows (severity-coloured label + View →) — put inside a Panel. */
export function AttentionList({
  items,
  emptyText = '✅ All clear — nothing needs attention.',
  renderLink,
}: AttentionListProps): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-4)' }}>
      {items.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 'var(--sp-4)',
            color: 'var(--sig-ok)',
            fontWeight: 700,
          }}
        >
          {emptyText}
        </div>
      ) : (
        items.map((a, i) => (
          <LinkSlot
            key={a.key ?? i}
            to={a.to}
            onClick={a.onClick}
            renderLink={renderLink}
            className="dash-link"
          >
            <div
              className="dash-surface"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                padding: 'var(--sp-2) var(--sp-1)',
                borderBottom: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 'var(--fs-sm)' }}>
                {a.icon}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 600,
                  color: SEV[a.severity ?? 'info'],
                }}
              >
                {a.label}
              </span>
              <span style={{ color: 'var(--text3)', fontSize: 'var(--fs-xs)' }}>View →</span>
            </div>
          </LinkSlot>
        ))
      )}
    </div>
  );
}

export interface StatRowProps {
  icon?: string | undefined;
  /** "GRNs received", "Ops running" — plain shop-floor English. */
  label: string;
  value: ReactNode;
  onClick?: (() => void) | undefined;
  to?: string | undefined;
  renderLink?: RenderLink | undefined;
}

/** "Today" stat row: emoji · label · mono number on bg3, hover = bg4 + blue border. */
export function StatRow({
  icon,
  label,
  value,
  onClick,
  to,
  renderLink,
}: StatRowProps): React.JSX.Element {
  const surface: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--sp-2)',
    padding: 'var(--sp-2)',
    background: 'var(--bg3)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius)',
  };
  return (
    <LinkSlot to={to} onClick={onClick} renderLink={renderLink} className="dash-link">
      <div className="dash-surface" style={surface}>
        <span aria-hidden="true" style={{ fontSize: 'var(--fs-md)' }}>
          {icon}
        </span>
        <div style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>{label}</div>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 800, fontFamily: 'var(--mono)' }}>
          {value}
        </div>
      </div>
    </LinkSlot>
  );
}

export interface QuickLink {
  icon?: string | undefined;
  /** Page name as the nav says it: "SO Master", "Op Entry", "GRN". */
  label: string;
  /** The module's department tint, e.g. var(--dept-sales). */
  color: string;
  onClick?: (() => void) | undefined;
  to?: string | undefined;
}

export interface QuickLinksProps {
  links: QuickLink[];
  title?: string | undefined;
  renderLink?: RenderLink | undefined;
}

/** 🚀 Quick Access chips tinted in the module's department colour (7% fill / 25% border). */
export function QuickLinks({
  links,
  title = '🚀 Quick Access',
  renderLink,
}: QuickLinksProps): React.JSX.Element {
  return (
    <div>
      <div
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 700,
          color: 'var(--text2)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        {links.map((l) => (
          <LinkSlot
            key={l.label}
            to={l.to}
            onClick={l.onClick}
            renderLink={renderLink}
            className="btn btn-sm"
            // .btn / .btn-sm already declare display, height, padding and font;
            // the <button> reset would flatten all four into a zero-padded
            // block. The chip is a control, so the class draws it.
            buttonReset={false}
            style={{
              padding: 'var(--sp-1) var(--sp-2)',
              background: `color-mix(in srgb, ${l.color} 7%, transparent)`,
              color: l.color,
              border: `1px solid color-mix(in srgb, ${l.color} 25%, transparent)`,
              fontSize: 'var(--fs-xs)',
            }}
          >
            {l.icon} {l.label}
          </LinkSlot>
        ))}
      </div>
    </div>
  );
}
