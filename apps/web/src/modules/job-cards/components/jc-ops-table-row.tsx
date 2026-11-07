// Job Card Operations tab — one operation ROW (the button in its Operation cell
// opens the popup, jc-op-popup.tsx) of the
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
import { JcOpPopup } from './jc-op-popup';
import { checkText, doneLabel } from './jc-ops-table-notes';

export const COLS = 19;

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
  /** This op's popup is open. */
  open: boolean;
  current: boolean;
  onOpen: () => void;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
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
  onOpen,
  onClose,
  onStep,
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

  const nextStep = primary ? (
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
  ) : null;
  const statusBadge = <span className={`badge ${st.cls}`}>{st.label}</span>;

  return (
    <>
      <tr className={trCls}>
        <td className={`td-ctr mono fw-700 jc-ops-opn jc-ops-k-${kind}`}>{fmtOpSrNo(op.opSeq)}</td>
        <td className="jc-ops-opc jc-ops-c-op" title={op.operation}>
          {/* Owner 2026-11-02: only this button opens the operation popup. */}
          <button
            type="button"
            className="jc-ops-open"
            title="Open this operation: machine, operator, times and recent logs"
            aria-haspopup="dialog"
            onClick={onOpen}
          >
            <b>{op.operation}</b>
          </button>
          {op.reworkPendingQty > 0 ? (
            <span
              className="badge b-amber"
              title={`${op.reworkPendingQty} piece(s) sent back to this operation for rework.`}
            >
              ♻ {op.reworkPendingQty}
            </span>
          ) : null}
        </td>
        <td
          className={`jc-ops-opc jc-ops-c-mv jc-ops-k-${kind}`}
          title={[code, name, hasOspLane ? vendorCode : null].filter(Boolean).join(' · ')}
        >
          <i>{code}</i>
          {name ? <span className="jc-ops-sub">{name}</span> : null}
          {hasOspLane ? (
            <span className="badge b-purple" title="In-house + OSP (outsource balance)">
              + OSP{vendorCode ? ` ${vendorCode}` : ''}
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
        <QtyTd v={flow?.sentToVendorQty} na={!hasOsp} sep title="First lot, sent on outward DCs" />
        <QtyTd
          v={flow?.vendorReceivedQty}
          na={!hasOsp}
          title={
            flow
              ? `First lot, received back${flow.inQcQty > 0 ? ` · ${flow.inQcQty} waiting incoming QC` : ''}`
              : undefined
          }
        />
        <QtyTd
          v={flow?.returnedToVendorQty}
          na={!hasOsp}
          title="Deviated pieces sent back to the vendor for rework"
        />
        <QtyTd
          v={flow?.reReceivedQty}
          na={!hasOsp}
          title="Of those, pieces the vendor sent back again"
        />
        <QtyTd
          v={flow?.atVendorQty}
          na={!hasOsp}
          title="Pieces with the vendor right now: Sent to Vendor − Received + Returned to Vendor − Re-received"
        />
        {/* Check — jc-flow-panels.tsx L191-208 */}
        <td className="td-ctr vsep" title={flow ? checkText(flow) : undefined}>
          {!flow ? (
            <span className="text3">—</span>
          ) : flow.unaccountedQty === 0 ? (
            <span className="jc-ops-chk">✓</span>
          ) : (
            <span className="jc-ops-chk is-off mono">⚠ {flow.unaccountedQty}</span>
          )}
        </td>
        <td className="td-ctr">{statusBadge}</td>
        <td className="td-ctr">{nextStep}</td>
        <td className="td-ctr">
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
        <JcOpPopup
          jc={jc}
          op={op}
          flow={flow}
          row={row}
          hasOspLane={hasOspLane}
          logs={logs}
          machineName={machineName}
          toolDetails={toolDetails}
          rmAvailable={rmAvailable}
          title={[op.operation, code, name].filter(Boolean).join(' · ')}
          statusBadge={statusBadge}
          action={primary ? nextStep : null}
          onClose={onClose}
          onStep={onStep}
        />
      ) : null}
    </>
  );
}
