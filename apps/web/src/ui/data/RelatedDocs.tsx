// <RelatedDocs> — the traceability panel at the foot of every document detail
// page: one tab per category of related paper, the chosen category's documents
// in a ruled sheet below it, and the document timeline underneath.
//
// It replaces TWO competing implementations (audit 02 §A/data):
//   · `related-docs-tabs.tsx`  — tabs, but drawn as a row of purple `.btn`s
//   · `related-docs-panel.tsx` — the same data as stacked section blocks
// One component, one look: the categories are drawn by <TabStrip>, THE one
// in-page tab look (blue wash + 3px blue underline), never a row of buttons
// pretending to be tabs and never a second hand-rolled tab strip beside it.
//
// Pure: it neither fetches nor routes. The caller passes the sections it has
// already loaded, and every `code` is a ReactNode so a page can hand in its own
// <Link> — a document type with no detail page hands in plain text instead, and
// no dead link is ever rendered.
//
// A module-specific panel that belongs in the strip (the SO's drawing trail,
// say) comes in through `extraTabs` rather than being baked in here.

import { useState } from 'react';
import { TabStrip, type TabStripTab } from '../navigation/TabStrip';
import { EmptyState } from './EmptyState';
import { Panel } from './Panel';
import { fmtDate } from '@/lib/date';

export interface RelatedDoc {
  /** Stable key — the document's id. */
  id?: string | undefined;
  /** The document number. ReactNode so the caller can wrap it in a <Link>. */
  code: React.ReactNode;
  /** Item name, party name or whatever names this row. */
  label?: React.ReactNode | undefined;
  /** A <StatusBadge>, passed in — this component owns no status colours. */
  status?: React.ReactNode | undefined;
  /** ISO date. */
  date?: string | null | undefined;
}

export interface RelatedDocsSection {
  key: string;
  title: string;
  /** Module emoji, e.g. '▭' for Job Cards. */
  icon?: string | undefined;
  items: RelatedDoc[];
  /** Overrides `items.length` on the tab's count badge. */
  count?: number | undefined;
}

export interface RelatedDocsExtraTab {
  key: string;
  title: string;
  icon?: string | undefined;
  /** Doubles as the badge and as the hide switch — a zero-count tab is dropped. */
  count: number;
  render: () => React.ReactNode;
}

export interface RelatedDocsProps {
  sections: RelatedDocsSection[];
  /** Module-supplied tabs, shown after the document categories. */
  extraTabs?: RelatedDocsExtraTab[] | undefined;
  /** Controlled selection. Omit both and the strip keeps its own state. */
  activeKey?: string | undefined;
  onSelect?: ((key: string) => void) | undefined;
  /** Keep categories with no documents. Default: drop them, as the app does. */
  showEmptySections?: boolean | undefined;
  title?: React.ReactNode | undefined;
  /** Goes under the table — normally <Timeline density="compact" …>. */
  children?: React.ReactNode | undefined;
  className?: string | undefined;
}

export function RelatedDocs({
  sections,
  extraTabs,
  activeKey,
  onSelect,
  showEmptySections = false,
  title = '🔗 Related Documents',
  children,
  className,
}: RelatedDocsProps): React.JSX.Element {
  // Uncontrolled fallback: null until something is clicked, so the strip opens
  // on the first category and follows the data if that category later empties.
  const [ownKey, setOwnKey] = useState<string | null>(null);
  const selectedKey = activeKey ?? ownKey;

  const shown = showEmptySections
    ? sections
    : sections.filter((s) => (s.count ?? s.items.length) > 0);
  const extras = (extraTabs ?? []).filter((t) => t.count > 0);

  const activeExtra = extras.find((t) => t.key === selectedKey) ?? null;
  // An extra tab is only ever active because it was clicked — it never wins the
  // fallback, so the panel still opens on the documents it has always shown.
  const active = activeExtra
    ? null
    : (shown.find((s) => s.key === selectedKey) ?? shown[0] ?? null);

  const select = (key: string): void => {
    if (onSelect) onSelect(key);
    if (activeKey === undefined) setOwnKey(key);
  };

  // One strip, one look: a document category and a module-supplied tab are the
  // same kind of tab, so they go into ONE <TabStrip> — the one in-page tab look
  // in this library. The emoji rides in the label, where every other in-page
  // tab carries it.
  const tabs: TabStripTab[] = [
    ...shown.map((s) => ({
      key: s.key,
      label: s.icon ? `${s.icon} ${s.title}` : s.title,
      count: s.count ?? s.items.length,
    })),
    ...extras.map((t) => ({
      key: t.key,
      label: t.icon ? `${t.icon} ${t.title}` : t.title,
      count: t.count,
    })),
  ];
  const activeTabKey = activeExtra?.key ?? active?.key;

  return (
    <Panel title={title} className={className}>
      {tabs.length > 0 ? (
        <TabStrip
          tabs={tabs}
          // TabStrip declares `activeKey?: string` without `| undefined`, so
          // spread it rather than pass an explicit undefined
          // (exactOptionalPropertyTypes).
          {...(activeTabKey === undefined ? {} : { activeKey: activeTabKey })}
          onChange={select}
          label="Related document categories"
        />
      ) : (
        // Every category is empty and no module tab applies — say so, rather
        // than draw an empty panel with nothing in it.
        <EmptyState>No related documents yet.</EmptyState>
      )}

      {activeExtra ? (
        <div style={{ marginBottom: children ? 'var(--sp-4)' : 0 }}>{activeExtra.render()}</div>
      ) : null}

      {active ? (
        active.items.length === 0 ? (
          <EmptyState inline>No documents in this category.</EmptyState>
        ) : (
          <table
            className="innovic-table tbl-grid tbl-compact"
            style={{ marginBottom: children ? 'var(--sp-4)' : 0 }}
          >
            <thead>
              <tr>
                <th>Document No.</th>
                <th>Name / Ref</th>
                <th>Document Status</th>
                <th>Document Date</th>
              </tr>
            </thead>
            <tbody>
              {active.items.map((d, i) => (
                <tr key={d.id ?? i}>
                  {/* The code is a `.td-code` span inside a `.mono` cell, as
                      the reference has it — the blue comes from
                      `.innovic-table.tbl-grid .td-code`, so no inline colour
                      here to fight a caller's own coloured node. */}
                  <td className="mono">
                    <span className="td-code">{d.code}</span>
                  </td>
                  <td className="text2 td-left">{d.label ?? '—'}</td>
                  <td>{d.status ?? '—'}</td>
                  <td className="mono text2" style={{ fontSize: 'var(--fs-xs)' }}>
                    {fmtDate(d.date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {children}
    </Panel>
  );
}
