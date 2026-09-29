// PageHeader — the page top band for everything that is not a list and not a
// record detail: create / edit forms, settings pages, workflow and report
// screens. Lists use ListHeader, detail pages use DetailHeader; nothing else
// may hand-roll a title row.
//
//   ← Back to SO Master                      (optional, names where you return)
//   📋 Create Sales Order                                  [Cancel] [Save SO]
//   Line items are added after the header is saved.        (optional subtitle)
//
// The canonical create/edit page is: PageHeader (title + Save/Cancel) →
// Panel(FormGrid) → Panel(line table) → ConfirmDialog exit guard.
//
// The band itself (sticky rule, title row, children slot) is HeaderBand, shared
// with ListHeader so a form header and a list header cannot drift apart.

import type { ReactNode } from 'react';
import { Icon } from '../core/Icon';
import { HeaderBand } from './header-band';

export interface PageHeaderProps {
  /** Title Case, named after the paper document: "Create Sales Order". */
  title: string;
  /** Module emoji from the nav, e.g. 📋 — identity only, never a control icon. */
  icon?: string | undefined;
  /** One quiet line under the title: what this page is for, or " · " metadata. */
  subtitle?: ReactNode | undefined;
  /** "Back to SO Master" — name the list you return to, never just "Back". */
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  /** Page actions, right-aligned: Cancel (ghost) then the primary Save last. */
  actions?: ReactNode | undefined;
  /** Optional band under the title row — a TabStrip, Banner or filter row. */
  children?: ReactNode | undefined;
  /** Pin the band while the page scrolls. Every create/edit form sets this so
   *  Save never scrolls away (ERPNext keeps its page head pinned the same way). */
  sticky?: boolean | undefined;
  /** The form has unsaved edits: shows an amber "Not saved" pill before the
   *  actions (ERPNext's "Not Saved" indicator). Pair with useSaveShortcut. */
  dirty?: boolean | undefined;
}

export function PageHeader({
  title,
  icon,
  subtitle,
  backLabel = 'Back',
  onBack,
  actions,
  children,
  sticky = false,
  dirty = false,
}: PageHeaderProps): React.JSX.Element {
  const band =
    dirty && actions ? (
      <>
        <span className="badge b-amber" role="status">
          Not saved
        </span>
        {actions}
      </>
    ) : (
      actions
    );
  return (
    <HeaderBand
      title={title}
      icon={icon}
      under={subtitle}
      sticky={sticky}
      // Form pages stack looser than lists: 12px under the band, not 8px.
      gap="var(--sp-3)"
      lead={
        onBack ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 'var(--sp-2)' }}
            onClick={onBack}
          >
            <Icon name="arrow-left" size={14} /> {backLabel}
          </button>
        ) : null
      }
      actions={band}
    >
      {children}
    </HeaderBand>
  );
}
