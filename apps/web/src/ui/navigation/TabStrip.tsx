// TabStrip — THE one in-page tab look
// (design-ref/components/navigation/TabStrip.*), derived from the Task Board's
// TaskTabs (modules/tasks/components/board-filters.tsx, ADR-176).
//
// Switches VIEWS within one page (Inbox / Outbox / My To-Do / All Tasks; the
// Job Card view tabs). Not to be confused with:
//   • PageTabs  — the browser-style open-pages strip in the shell chrome.
//   • StatStrip — counts that also act as filters.
//   • StatusPills — pill-shaped status filter chips.
// Active tab = blue wash + 3px blue underline + blue bold label.
//
// Presentational only: the caller owns `activeKey` and supplies counts, so
// /__ui-kit can render it in every state without a data fetch.

export interface TabStripTab {
  key: string;
  label: string;
  /** Count badge; null/undefined shows no badge (a count that is still
   *  loading passes null, not 0). */
  count?: number | null;
  /** Muted suffix, e.g. "(Admin)". */
  note?: string;
}

export interface TabStripProps {
  tabs: TabStripTab[];
  activeKey?: string;
  onChange?: (key: string) => void;
  /** Accessible name for the tab list. */
  label?: string;
}

export function TabStrip({ tabs, activeKey, onChange, label }: TabStripProps): React.JSX.Element {
  return (
    <div
      role="tablist"
      className="panel"
      {...(label ? { 'aria-label': label } : {})}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        marginBottom: 'var(--panel-gap)',
        // Square off the bottom corners: the strip sits directly on the panel
        // it switches, so only the top corners are rounded.
        borderRadius: 'var(--radius2) var(--radius2) 0 0',
      }}
    >
      {tabs.map((t, i) => {
        const on = t.key === activeKey;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(t.key)}
            style={{
              background: on ? 'var(--blue3)' : 'transparent',
              border: 'none',
              // Hairline between tabs, none after the last one.
              borderRight: i < tabs.length - 1 ? '1px solid var(--border)' : 'none',
              // 3px accent underline — the active marker for in-page tabs.
              borderBottom: `3px solid ${on ? 'var(--blue)' : 'transparent'}`,
              padding: 'var(--sp-2) var(--sp-4)',
              cursor: 'pointer',
              font: 'inherit',
              fontFamily: 'var(--bfont)',
              fontSize: 'var(--fs-sm)',
              fontWeight: on ? 700 : 600,
              color: on ? 'var(--blue)' : 'var(--text2)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--sp-1)',
            }}
          >
            {t.label}
            {/* No style override: .badge (innovic-theme.css:900-906) already
                gives exactly this padding, and its --radius-sm is the radius
                spacing.css:20 reserves for badges/tags/chips. design-ref's
                10px is a legacy pill value; --radius2 is the panel/card
                radius and does not belong on a chip. */}
            {t.count != null ? <span className="badge b-blue">{t.count}</span> : null}
            {t.note ? (
              <small className="text3" style={{ fontWeight: 400 }}>
                {t.note}
              </small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
