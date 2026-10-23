// ADR-250 — one document row on the home (lists, Sent by me, Waiting on others):
// document (number + sub line) · item · qty · status pill · action symbols.
// Presentational: every figure and every action comes from the server.

import type { DashAction, DashRow, DashTone } from '@innovic/shared';
import { ActionLink, useCanWrite } from '@/components/shared/action-link';
import { DashTextView, DocRef, linkProps } from './dash-text';
import { useRemind } from '../use-remind';

/** The symbol each action kind shows. Approve / reject live on the inbox row. */
const SYMBOL: Record<DashAction['kind'], string> = {
  create: '＋',
  open: '↗',
  inspect: '▶',
  start: '▶',
  remind: '⏰',
};

export const fmtQty = (n: number): string => n.toLocaleString('en-IN');
export const fmtAmount = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function StatusPill({ label, tone }: { label: string; tone: DashTone }): React.JSX.Element {
  return <span className={`dh-pill t-${tone}`}>{label}</span>;
}

/** Item code (bold mono) + name, one line, ellipsis. */
export function ItemCell({
  code,
  name,
  extra,
}: {
  code: string | null;
  name: string | null;
  extra?: string | undefined;
}): React.JSX.Element {
  const title = [code, name, extra].filter(Boolean).join(' ');
  return (
    <div className="dh-it" title={title}>
      {code ? <span className="dh-code">{code}</span> : null}{' '}
      <span className="dh-mut">{name ?? (code ? '' : '—')}</span>
      {extra ? <span className="dh-mut"> · {extra}</span> : null}
    </div>
  );
}

/** The header row: [document, item, qty, status] + an empty action column. */
export function RowHead({
  head,
  approve,
}: {
  head: readonly [string, string, string, string];
  approve?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div className={`dh-row dh-hd${approve ? ' dh-ap' : ''}`} aria-hidden="true">
      {approve ? <span /> : null}
      <span>{head[0]}</span>
      <span>{head[1]}</span>
      <span className="dh-q">{head[2]}</span>
      <span>{head[3]}</span>
      <span />
    </div>
  );
}

function RemindIcon({ action }: { action: DashAction }): React.JSX.Element | null {
  // Creating a task is a write: none for an Auditor (same gate as AssignTaskButton).
  const canWrite = useCanWrite();
  const remind = useRemind();
  if (!canWrite || !action.taskFor) return null;
  const taskFor = action.taskFor;
  return (
    <button
      type="button"
      className="dh-ic k-remind"
      title={action.label}
      aria-label={action.label}
      aria-busy={remind.busy}
      onClick={() => remind.send(taskFor, action.label)}
    >
      {SYMBOL.remind}
    </button>
  );
}

/** One action symbol. A page action is an ActionLink — hidden when the caller
 *  cannot open the target page; remind creates a linked task. */
export function ActionIcon({ action }: { action: DashAction }): React.JSX.Element | null {
  if (action.kind === 'remind') return <RemindIcon action={action} />;
  if (!action.href) return null;
  return (
    <ActionLink
      {...linkProps(action.href)}
      check={action.href}
      className={`dh-ic k-${action.kind}`}
      title={action.label}
      aria-label={action.label}
    >
      {SYMBOL[action.kind]}
    </ActionLink>
  );
}

export function DashRowView({ row }: { row: DashRow }): React.JSX.Element {
  const qty = row.qty == null ? '—' : `${fmtQty(row.qty)}${row.uom ? ` ${row.uom}` : ''}`;
  return (
    <div className="dh-row">
      <div className="dh-d">
        <span className="dh-code">
          <DocRef code={row.docCode} href={row.docHref} />
        </span>
        {row.sub.length > 0 ? (
          <div className="dh-sub">
            <DashTextView text={row.sub} />
          </div>
        ) : null}
      </div>
      <ItemCell
        code={row.itemCode}
        name={row.itemName}
        extra={row.amount == null ? undefined : fmtAmount(row.amount)}
      />
      <div className="dh-q">{qty}</div>
      <div className="dh-p">
        <StatusPill label={row.statusLabel} tone={row.tone} />
      </div>
      <div className="dh-a">
        {row.actions.map((a, i) => (
          <ActionIcon key={`${a.kind}-${i}`} action={a} />
        ))}
      </div>
    </div>
  );
}
