// HeaderBand — the page-top band itself, owned in ONE place.
//
// There are two public headers: ListHeader for lists and registers, PageHeader
// for forms, settings, workflow and report screens. They differ in what they
// PUT in the band — a count line and a search/tools/primary toolbar, versus a
// back button, a subtitle and Save/Cancel — and in nothing else. The band is
// the same sticky rule, the same title row and the same children slot, so it
// is drawn here once; two copies across ~97 list screens and every form screen
// is exactly the drift the consolidation exists to end.
//
// Not exported from ui/layout/index.ts: screens compose ListHeader or
// PageHeader, never the band directly.

import type { CSSProperties, ReactNode } from 'react';

export interface HeaderBandProps {
  /** Page title, named after the paper document. */
  title: string;
  /** Module emoji from the nav — identity only, never a control icon. */
  icon?: string | undefined;
  /** The quiet line under the title: a count line, or a page subtitle. */
  under?: ReactNode | undefined;
  /** Rendered above the title row — the "← Back to SO Master" button. */
  lead?: ReactNode | undefined;
  /** Right-hand cluster: search + tools + primary, or the page's Cancel/Save. */
  actions?: ReactNode | undefined;
  /** The band under the title row: StatStrip, StatusPills, TabStrip, Banner. */
  children?: ReactNode | undefined;
  /** Pin the band while the page scrolls. */
  sticky?: boolean | undefined;
  /** Bottom margin when NOT sticky — a spacing token, never a raw px. */
  gap?: string | undefined;
  /** A list title holds one line; a long form title may wrap. */
  nowrapTitle?: boolean | undefined;
}

export function HeaderBand({
  title,
  icon,
  under,
  lead,
  actions,
  children,
  sticky = false,
  gap = 'var(--sp-2)',
  nowrapTitle = false,
}: HeaderBandProps): React.JSX.Element {
  const band: CSSProperties = sticky
    ? {
        // Opaque --bg so rows never show through as they scroll under it.
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--bg)',
        paddingBottom: 'var(--sp-2)',
        marginBottom: 'var(--sp-2)',
        borderBottom: '1px solid var(--border)',
      }
    : { marginBottom: gap };

  return (
    <div style={band}>
      {lead}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: children ? 'var(--sp-2)' : 0,
        }}
      >
        <div style={nowrapTitle ? { flexShrink: 0 } : { minWidth: 0 }}>
          <div
            className="section-hdr"
            style={nowrapTitle ? { marginBottom: 0, whiteSpace: 'nowrap' } : { marginBottom: 0 }}
          >
            {icon ? `${icon} ` : ''}
            {title}
          </div>
          {under != null ? (
            // --sp-0 (2px) is scoped by the rules block to badges and compact /
            // editable table cells; the first real step under a title is 4px.
            <div className="text3" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-1)' }}>
              {under}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
