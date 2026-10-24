// ADR-250 — the home's panel shell (title + count + right-side tabs) and the
// small tab switch used by Approval inbox, My to-do and Done.

import type { DashList } from '@innovic/shared';
import { ActionLink } from '@/components/shared/action-link';
import { linkProps } from './dash-text';
import { DashRowView, RowHead } from './dash-row';

export function HomePanel({
  title,
  count,
  right,
  children,
  panelRef,
}: {
  title: string;
  count?: number | undefined;
  right?: React.ReactNode;
  children: React.ReactNode;
  panelRef?: React.Ref<HTMLElement> | undefined;
}): React.JSX.Element {
  return (
    <section className="dh-panel" ref={panelRef} aria-label={title}>
      <div className="dh-ph">
        <h2>
          {title}
          {count != null ? <span className="dh-cnt">{count}</span> : null}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function HomeTabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (k: K) => void;
}): React.JSX.Element {
  return (
    <span className="dh-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-pressed={value === t.key}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </span>
  );
}

export function Empty({ text }: { text: string }): React.JSX.Element {
  return <div className="dh-empty">{text}</div>;
}

/** "View all (total)" — only when the list holds more than it shows. */
export function ViewAll({ href, total }: { href: string; total: number }): React.JSX.Element {
  return (
    <div className="dh-more">
      <ActionLink {...linkProps(href)} check={href} className="dh-link">
        View all ({total})
      </ActionLink>
    </div>
  );
}

const EMPTY_TEXT: Record<DashList['key'], string> = {
  pr_to_po: 'Nothing to order.',
  po_to_dc: 'Nothing to send.',
  grn_qc: 'Nothing to inspect.',
  so_to_plan: 'Nothing to plan.',
  plan_to_pro: 'Nothing to release.',
  ops_ready: 'Nothing ready to run.',
  ops_running: 'Nothing running.',
  jc_running: 'No open job cards.',
  po_overdue: 'Nothing overdue.',
  bom_pending: 'No BOM waiting.',
  capa_mine: 'No CAPA on you.',
  qc_report_missing: 'No QC report missing.',
};

/** One server list, in the server's order (late first, then oldest). Rows and
 *  `total` are already filtered for the My department / Mine scope. */
export function DashListPanel({ list }: { list: DashList }): React.JSX.Element {
  return (
    <HomePanel title={list.title} count={list.total}>
      {list.rows.length === 0 ? (
        <Empty text={EMPTY_TEXT[list.key]} />
      ) : (
        <>
          <RowHead head={list.head} />
          {list.rows.map((r) => (
            <DashRowView key={r.key} row={r} />
          ))}
        </>
      )}
      {list.total > list.rows.length ? <ViewAll href={list.href} total={list.total} /> : null}
    </HomePanel>
  );
}
