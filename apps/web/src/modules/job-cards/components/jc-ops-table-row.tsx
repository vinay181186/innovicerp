// Job Card Operations tab — one operation ROW (+ its ▸ detail row) of the
// table in jc-ops-table.tsx. Split out to keep each file under the 400-line
// rule; see jc-ops-table.tsx for what the table is and where each figure and
// gate comes from.
import type {
  EffectiveAccess,
  JcOpEnriched,
  JcOpsBoardRow,
  JobCardListItem,
  JobCardRmAvailable,
  OpLog,
} from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import type { OpFlowRow } from '@/modules/flow-views/types';
import { useJcOpsBoard } from '@/modules/jc-ops/api';
import { RowMenu } from '@/ui/data';
import { OP_STATUS } from '../lib/jc-op-labels';
import { opActions, type OpAction, type OpActionTarget } from './jc-ops-table-actions';
import { JcOpsTableDetail } from './jc-ops-table-detail';
import { checkText, doneLabel } from './jc-ops-table-notes';

export const COLS = 17;

type Navigate = ReturnType<typeof useNavigate>;

/** One typed navigate per target (a union spread into navigate() does not
 *  type-check against the route tree). */
function go(navigate: Navigate, t: OpActionTarget): void {
  switch (t.to) {
    case '/op-entry':
      void navigate({ to: '/op-entry', search: t.search });
      return;
    case '/qc-call-register':
      void navigate({ to: '/qc-call-register', search: t.search });
      return;
    case '/nc-register':
      void navigate({ to: '/nc-register', search: t.search });
      return;
    case '/purchase-orders/from-pr':
      void navigate({ to: '/purchase-orders/from-pr', search: t.search });
      return;
    case '/delivery-challans/new':
      void navigate({ to: '/delivery-challans/new', search: t.search });
      return;
    case '/delivery-challans/$id/receive':
      void navigate({ to: '/delivery-challans/$id/receive', params: t.params });
      return;
    case '/incoming-qc':
      void navigate({ to: '/incoming-qc' });
      return;
  }
}

/** A quantity cell: right-aligned mono, muted at zero, a dash where the fact
 *  does not apply (jc-flow-panels.tsx `Qty`, L26-44). */
function QtyTd({
  v,
  na = false,
  tone = '',
  sep = false,
  title,
}: {
  v: number | undefined;
  na?: boolean;
  tone?: string;
  sep?: boolean;
  title?: string | undefined;
}): React.JSX.Element {
  const cls = ['td-num', 'mono', sep ? 'vsep' : ''];
  if (na || v === undefined) cls.push('jc-ops-q0');
  else cls.push(v === 0 ? 'jc-ops-q0' : tone);
  return (
    <td className={cls.filter(Boolean).join(' ')} title={title}>
      {na || v === undefined ? '—' : v}
    </td>
  );
}

const PENDING_TITLE = (o: OpFlowRow): string =>
  // jc-flow-panels.tsx L155-161.
  o.opType === 'qc'
    ? 'Still to inspect at this QC op'
    : o.opType === 'outsource'
      ? 'Not yet sent to the vendor'
      : 'Still to make at this op' + (o.qcRequired ? ' (plus made pieces waiting for its QC)' : '');

export interface RowProps {
  jc: JobCardListItem;
  op: JcOpEnriched;
  flow: OpFlowRow | undefined;
  eff: EffectiveAccess | undefined;
  stopped: boolean;
  open: boolean;
  current: boolean;
  onToggle: () => void;
  rowRef: ((el: HTMLTableRowElement | null) => void) | undefined;
  logs: OpLog[];
  machineName: string | null;
  toolDetails: string | null;
  rmAvailable: JobCardRmAvailable | null;
}

/** An op with an outsource lane needs the jc-ops board row (vendor, PR / PO,
 *  open DC). Same query as jc-op-actions.tsx useOutsourceRow (L56-59), so the
 *  page still issues no board request on a card with no outsource work. */
export function OpRowWithBoard(props: RowProps): React.JSX.Element {
  const { data } = useJcOpsBoard({ jcCode: props.jc.code, limit: 500, offset: 0 });
  const row = data?.items.find((r) => r.jcOpId === props.op.id);
  return <OpRow {...props} row={row} />;
}

export function OpRow({
  jc,
  op,
  flow,
  eff,
  stopped,
  open,
  current,
  onToggle,
  rowRef,
  logs,
  machineName,
  toolDetails,
  rmAvailable,
  row,
}: RowProps & { row: JcOpsBoardRow | undefined }): React.JSX.Element {
  const navigate = useNavigate();
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  // ADR-081 — an in-house op whose balance went to a vendor.
  const hasOspLane = !isQc && !isOut && flow?.hasOsp === true;
  const kind = isQc ? 'qc' : isOut ? 'osp' : 'mc';
  const st = OP_STATUS[op.computedStatus] ?? { label: op.computedStatus, cls: 'b-grey' };
  const acts = opActions({ eff, jcCode: jc.code, op, hasOspLane, row, stopped });
  const primary = acts.primary;

  const code = isQc
    ? 'QC'
    : isOut
      ? (row?.outsourceVendorCode ?? 'Outsource')
      : (op.machineCode ?? op.machineCodeText ?? '—');
  const name = isOut ? (row?.outsourceVendorName ?? null) : isQc ? null : machineName;
  const vendorCode = row?.outsourceVendorCode ?? row?.outsourceVendorName ?? null;

  const trCls = [
    'jc-ops-row',
    isQc ? 'jc-ops-qc' : '',
    isOut ? 'jc-ops-osp' : '',
    current ? 'jc-ops-cur' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const hasOsp = flow?.hasOsp ?? isOut;

  const btnCls = (a: OpAction): string =>
    a.tone === 'primary'
      ? 'btn btn-sm btn-primary'
      : a.tone === 'qc'
        ? 'btn btn-sm jc-ops-btn-qc'
        : 'btn btn-sm';

  return (
    <>
      <tr className={trCls} ref={rowRef} onClick={onToggle}>
        <td className="jc-ops-exp">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Hide operation detail' : 'Show operation detail'}
            title={open ? 'Hide detail' : 'Show machine, operator, times and recent logs'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        </td>
        <td className={`mono fw-700 jc-ops-opn jc-ops-k-${kind}`}>{fmtOpSrNo(op.opSeq)}</td>
        <td
          className={`jc-ops-opc jc-ops-k-${kind}`}
          title={[op.operation, code, name].filter(Boolean).join(' · ')}
        >
          <b>{op.operation}</b> <i>{code}</i>
          {name ? <span className="jc-ops-sub"> {name}</span> : null}
          {hasOspLane ? (
            <span className="badge b-purple" title="In-house + OSP (outsource balance)">
              + OSP{vendorCode ? ` ${vendorCode}` : ''}
            </span>
          ) : null}
          {op.reworkPendingQty > 0 ? (
            <span
              className="badge b-amber"
              title={`${op.reworkPendingQty} piece(s) sent back to this operation for rework.`}
            >
              ♻ {op.reworkPendingQty}
            </span>
          ) : null}
        </td>
        {/* At this operation — jc-flow-panels.tsx L94-163 */}
        <QtyTd
          v={flow?.inputQty}
          sep
          title="What the previous op passed on (Order Qty on the first op)"
        />
        <QtyTd v={flow?.doneQty} sep title={flow ? doneLabel(flow) : undefined} />
        <QtyTd
          v={flow?.acceptedQty}
          tone="jc-ops-q-good"
          title="Good pieces that move on to the next op"
        />
        <QtyTd
          v={flow?.deviatedQty}
          tone="jc-ops-q-warn"
          sep
          title={
            flow
              ? `Failed inspection → NC for a decision. Production ${flow.productionRejectedQty} · QC ${flow.qcRejectedQty}` +
                (flow.hasOsp ? ` · Incoming QC ${flow.vendorRejectedQty}` : '')
              : undefined
          }
        />
        <QtyTd
          v={flow?.reworkedQty}
          tone="jc-ops-q-rw"
          title="Deviated pieces an NC recovered (rework / repair / use as is / return to vendor) and that were accepted"
        />
        <QtyTd
          v={flow?.rejectedFinalQty}
          tone="jc-ops-q-bad"
          title="Final NC decision: scrap / make fresh, or failed rework / repair"
        />
        <QtyTd
          v={flow?.pendingQty}
          tone="jc-ops-q-warn"
          sep
          title={flow ? PENDING_TITLE(flow) : undefined}
        />
        {/* With vendor (outsource) — jc-flow-panels.tsx L164-190 */}
        <QtyTd
          v={flow?.vendorSentQty}
          na={!hasOsp}
          sep
          title={
            flow && flow.returnedToVendorQty > 0
              ? `${flow.vendorSentQty - flow.returnedToVendorQty} on outward DCs + ${flow.returnedToVendorQty} re-sent for rework`
              : 'Sent on outward DCs'
          }
        />
        <QtyTd
          v={flow?.vendorReceivedQty}
          na={!hasOsp}
          title={
            flow
              ? `Received back incl. re-received lots${flow.inQcQty > 0 ? ` · ${flow.inQcQty} waiting incoming QC` : ''}`
              : undefined
          }
        />
        <QtyTd v={flow?.atVendorQty} na={!hasOsp} title="Pieces with the vendor right now" />
        {/* Check — jc-flow-panels.tsx L191-208 */}
        <td className="vsep" title={flow ? checkText(flow) : undefined}>
          {!flow ? (
            <span className="text3">—</span>
          ) : flow.unaccountedQty === 0 ? (
            <span className="jc-ops-chk">✓</span>
          ) : (
            <span className="jc-ops-chk is-off mono">⚠ {flow.unaccountedQty}</span>
          )}
        </td>
        <td>
          <span className={`badge ${st.cls}`}>{st.label}</span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {primary ? (
            <button
              type="button"
              className={btnCls(primary)}
              title={primary.title}
              onClick={() => go(navigate, primary.target)}
            >
              {primary.label}
            </button>
          ) : acts.text ? (
            <span className={`jc-ops-nb-${acts.text.tone}`}>{acts.text.label}</span>
          ) : null}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <RowMenu
            label={`Op ${fmtOpSrNo(op.opSeq)} actions`}
            items={acts.more.map((a) => ({
              key: a.key,
              label: a.label,
              icon: a.icon,
              group: 'workflow' as const,
              onSelect: () => go(navigate, a.target),
            }))}
          />
        </td>
      </tr>
      {open ? (
        <tr className="jc-ops-det">
          <td colSpan={COLS}>
            <JcOpsTableDetail
              jc={jc}
              op={op}
              flow={flow}
              row={row}
              hasOspLane={hasOspLane}
              logs={logs}
              machineName={machineName}
              toolDetails={toolDetails}
              rmAvailable={rmAvailable}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
