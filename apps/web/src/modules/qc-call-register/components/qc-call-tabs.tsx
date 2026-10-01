// QC Call Register — the QC Calls | TPI tab bar that sits above whichever tab is
// showing. The app shell owns the gutter and the width; the content scrolls
// inside its own .tbl-wrap. Split out of routes/index.tsx so that file stays
// under the 400-line ceiling. The TPI tab's content (TpiView) is external and
// rendered by the page untouched — this only draws the switch.

import type { ReactNode } from 'react';

export function QcCallTabs(props: {
  tab: 'qc' | 'tpi';
  setTab: (t: 'qc' | 'tpi') => void;
  children: ReactNode;
}): React.JSX.Element {
  const { tab, setTab, children } = props;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {(
          [
            ['qc', 'QC Calls'],
            ['tpi', 'TPI'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === key ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
