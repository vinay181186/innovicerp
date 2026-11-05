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
//
// The item reads ONE way in every tab (owner 2026-11-05): POL | Item Code | Item
// Name, the code dark and bold, a document number blue, a missing value `—`.
//   mode 'documents'  Document No. | POL | Item Code | Item Name | [label] | Status | Date
//                     ONE ROW PER ITEM; the tab's count stays the document count.
//   mode 'items'      Item Code | Item Name — the rows ARE items.
//   mode 'none'       Document No. | [label] | Status | Date — no item columns.

import { useState } from 'react';
import { TabStrip, type TabStripTab } from '../navigation/TabStrip';
import { EmptyState } from './EmptyState';
import { Panel } from './Panel';
import { fmtDate } from '@/lib/date';

/** One item a row concerns. The code is a ReactNode so a caller can link it. */
export interface RelatedDocItem {
  /** POL — the customer's PO line number. */
  pol?: string | null | undefined;
  /** CODE/REV. */
  code: React.ReactNode;
  name?: string | null | undefined;
}

export type RelatedDocsMode = 'documents' | 'items' | 'none';

export interface RelatedDoc {
  /** Stable key — the document's id. */
  id?: string | undefined;
  /** The document number. ReactNode so the caller can wrap it in a <Link>. */
  code: React.ReactNode;
  /** The one extra fact the section names in `labelHeading` — never the item. */
  label?: React.ReactNode | undefined;
  /** A <StatusBadge>, passed in — this component owns no status colours. */
  status?: React.ReactNode | undefined;
  /** ISO date. */
  date?: string | null | undefined;
  /** The items this row concerns. Read by modes 'documents' and 'items'. */
  items?: RelatedDocItem[] | undefined;
}

export interface RelatedDocsSection {
  key: string;
  title: string;
  /** Module emoji, e.g. '▭' for Job Cards. */
  icon?: string | undefined;
  items: RelatedDoc[];
  /** Overrides `items.length` on the tab's count badge. */
  count?: number | undefined;
  /** How the tab reads. Default 'none'. */
  mode?: RelatedDocsMode | undefined;
  /** Heading of the first column. Default "Document No.". */
  codeHeading?: string | null | undefined;
  /** Heading of the `label` column. Unset = the tab has no such column. */
  labelHeading?: string | null | undefined;
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

/** The chosen tab's ruled sheet. Pure: every value comes from the section. */
function RelatedSheet({
  section,
  style,
}: {
  section: RelatedDocsSection;
  style: React.CSSProperties;
}): React.JSX.Element {
  const mode = section.mode ?? 'none';
  const { labelHeading } = section;
  const docCols = mode !== 'items';
  const itemCols = mode !== 'none';
  // A tab with no item columns drops status + date when no row has either.
  const statusCols =
    mode === 'documents' || (mode === 'none' && section.items.some((d) => d.status || d.date));
  // One row per item: a document with three items gives three rows, its number
  // repeated; with none, one row of dashes. Row index in the key: a number repeats.
  const rows = section.items.flatMap((doc, i) => {
    const items: (RelatedDocItem | null)[] = itemCols && doc.items?.length ? doc.items : [null];
    return items.map((item, j) => ({ key: `${doc.id ?? i}:${j}`, doc, item }));
  });
  return (
    <table className="innovic-table tbl-grid tbl-compact" style={style}>
      <thead>
        <tr>
          {docCols ? <th>{section.codeHeading ?? 'Document No.'}</th> : null}
          {mode === 'documents' ? <th>POL</th> : null}
          {itemCols ? <th>Item Code</th> : null}
          {itemCols ? <th>Item Name</th> : null}
          {docCols && labelHeading ? <th>{labelHeading}</th> : null}
          {statusCols ? <th>Document Status</th> : null}
          {statusCols ? <th>Document Date</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, doc, item }) => (
          <tr key={key}>
            {/* The code is a `.td-code` span inside a `.mono` cell, as the
                reference has it — the blue comes from
                `.innovic-table.tbl-grid .td-code`, so no inline colour here to
                fight a caller's own coloured node. */}
            {docCols ? (
              <td className="mono">
                <span className="td-code">{doc.code}</span>
              </td>
            ) : null}
            {mode === 'documents' ? (
              <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                {item?.pol ?? '—'}
              </td>
            ) : null}
            {/* The item code is the main thing: dark and bold, never `.td-code` blue. */}
            {itemCols ? (
              <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                {item?.code ?? '—'}
              </td>
            ) : null}
            {/* Whole, on as many lines as it takes: never cut short. */}
            {itemCols ? (
              <td className="td-left" style={{ whiteSpace: 'normal' }}>
                {item?.name ?? '—'}
              </td>
            ) : null}
            {docCols && labelHeading ? <td className="text2 td-left">{doc.label ?? '—'}</td> : null}
            {statusCols ? <td>{doc.status ?? '—'}</td> : null}
            {statusCols ? (
              <td className="mono text2" style={{ fontSize: 'var(--fs-xs)' }}>
                {fmtDate(doc.date)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
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

  // No document tabs at all: the first extra (History) opens by itself, not an empty body.
  const activeExtra =
    extras.find((t) => t.key === selectedKey) ?? (shown.length === 0 ? (extras[0] ?? null) : null);
  // With document tabs present, an extra tab is active only when clicked — it never wins the
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
          <RelatedSheet section={active} style={{ marginBottom: children ? 'var(--sp-4)' : 0 }} />
        )
      ) : null}

      {children}
    </Panel>
  );
}
