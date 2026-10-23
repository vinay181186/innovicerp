// ADR-250 — the home lists. ONE registry: each list names the right its next
// step needs (the gate), the query that finds its rows (list-query shape), the
// document's own page, and the action links. A list is built only for a
// caller holding every right it names (hasTick); each action is kept only if
// the page it opens opens for the caller (canSeeLink — a per-page Hide or a
// missing tick drops it). No greyed buttons: what is not allowed is not sent.

import {
  ACCESS_FORMS,
  type AccessAction,
  type AccessFormKey,
  type DashAction,
  type DashList,
  type DashListKey,
  type DashRow,
  type DashText,
  type DashTone,
  docNavPage,
  opSrNo,
} from '@innovic/shared';
import type { SQL } from 'drizzle-orm';
import { type DashAccess, canSeeLink, hasTick } from '../access';
import type { ListFilter, RawRow } from './list-query';
import { poDraftSql, poOverdueSql, poToDcSql, prPendingSql, prToPoSql } from './rows-purchase';
import { bomPendingSql, planToProSql, soToPlanSql } from './rows-planning';
import { jcRunningSql, opsReadySql, opsRunningSql } from './rows-production';
import { capaMineSql, grnQcSql, qcReportMissingSql } from './rows-qc';
import { codePart, entityHref, runningStatus, shortDate, statusFor } from './util';

export interface ListCtx {
  cid: string;
  today: string;
  myName: string;
}

type Right = readonly [AccessFormKey, AccessAction];
type Candidate = Omit<DashAction, 'taskFor'>;

export interface ListDef {
  key: DashListKey | 'pr_pending' | 'po_draft';
  title: string;
  head: DashList['head'];
  href: string;
  /** Every right the list needs; the FIRST is the next step (dept, holders). */
  rights: readonly Right[];
  /** Page whose Price right shows `amount` (null = no money on this list). */
  priceForm: AccessFormKey | null;
  query: (c: ListCtx, f: ListFilter) => SQL;
  docHref: (r: RawRow) => string;
  /** The task "linked ref" type for a Remind on this document. */
  refType: (r: RawRow) => string;
  sub: (r: RawRow) => DashText;
  actions: (r: RawRow) => Candidate[];
  /** The status cell when it is not the due-date / age rule (statusFor). */
  status?: (r: RawRow) => { statusLabel: string; tone: DashTone };
}

const enc = encodeURIComponent;
const partyText = (r: RawRow, extra?: string | null): DashText => {
  const words = [r.party, extra].filter((w): w is string => !!w).join(' · ');
  return words ? [{ text: words }] : [];
};
const withCode = (r: RawRow, label: string, code: string | null, href: string | null): DashText => {
  const out = partyText(r);
  if (!code) return out;
  return [...out, { text: `${out.length ? ' · ' : ''}${label} ` }, codePart(code, href)];
};
const open = (href: string, label = 'Open'): Candidate => ({ kind: 'open', label, href });

// Every document page through docNavPage (one place per page); a party GRN
// opens by its number (entityHref explains why).
const prHref = (r: RawRow) => docNavPage('purchase-request', r.id);
const poHref = (r: RawRow) => docNavPage('purchase-order', r.id);
const jcHref = (r: RawRow) => docNavPage('job-card', r.id);
const grnHref = (r: RawRow) =>
  r.kind === 'party_grn' ? entityHref('PartyGrn', r.id, r.code)! : docNavPage('grn', r.id);
const grnInspectHref = (r: RawRow): string => {
  if (r.kind === 'party_grn') return `/incoming-qc?search=${encodeURIComponent(r.code)}`;
  const line = encodeURIComponent(r.x1 ?? '');
  if (r.kind === 'job_work_return' || r.kind === 'nc_return')
    return `/qc-call-register?line=${line}`;
  return `/incoming-qc?line=${line}`;
};
const orderHref = (r: RawRow) =>
  r.kind === 'jw' ? docNavPage('job-work-order', r.id) : docNavPage('sales-order', r.id);
const opText = (r: RawRow): DashText => [
  { text: [`Op ${opSrNo(Number(r.x2 ?? 0))}`, r.x3, r.party].filter(Boolean).join(' · ') },
];

export const LIST_DEFS: readonly ListDef[] = [
  {
    key: 'pr_to_po',
    title: 'PRs to order',
    head: ['PR No.', 'Item', 'Pending', 'Status'],
    href: '/purchase-requests',
    rights: [['po_create', 'entry']],
    priceForm: 'pr_create',
    query: (c, f) => prToPoSql(c.cid, c.today, f),
    docHref: prHref,
    refType: () => 'purchase_request',
    sub: (r) => partyText(r),
    actions: (r) => [
      { kind: 'create', label: 'Create PO', href: `/purchase-orders/from-pr?prId=${r.id}` },
    ],
  },
  {
    key: 'po_to_dc',
    title: 'Material to send',
    head: ['PO No.', 'Item', 'Pending', 'Status'],
    href: '/purchase-orders',
    rights: [['ospdc_create', 'entry']],
    priceForm: 'po_create',
    query: (c, f) => poToDcSql(c.cid, c.today, f),
    docHref: poHref,
    refType: () => 'purchase_order',
    sub: (r) => partyText(r),
    actions: (r) => [
      { kind: 'create', label: 'Create DC', href: `/delivery-challans/new?poId=${r.id}` },
    ],
  },
  {
    key: 'grn_qc',
    title: 'Incoming QC',
    head: ['GRN No.', 'Item', 'Received', 'Status'],
    // ADR-251: the tile lists EVERY incoming call (OSP / NC returns too), so
    // its "all" link is the QC Call Register, whose Incoming stage it matches.
    href: '/qc-call-register',
    rights: [['qc_incoming', 'entry']],
    priceForm: null,
    query: (c, f) => grnQcSql(c.cid, f),
    docHref: grnHref,
    refType: (r) => (r.kind === 'party_grn' ? 'party_grn' : 'grn'),
    sub: (r) =>
      r.kind === 'party_grn'
        ? withCode(r, 'JWSO', r.x3, r.x2 ? docNavPage('job-work-order', r.x2) : null)
        : withCode(r, 'PO', r.x3, r.x2 ? docNavPage('purchase-order', r.x2) : null),
    // ADR-251: Inspect opens the page that lists the call — Party GRN and
    // Against PO on Incoming QC; Against JW PO / DC and Against NC on the QC
    // Call Register. kind = 'party_grn' or the GRN Type (rows-qc.ts).
    actions: (r) => [{ kind: 'inspect', label: 'Inspect', href: grnInspectHref(r) }],
  },
  {
    key: 'so_to_plan',
    title: 'Orders to plan',
    head: ['SO No.', 'Item', 'To Plan', 'Status'],
    href: '/planning',
    rights: [['plan_create', 'entry']],
    priceForm: null,
    query: (c, f) => soToPlanSql(c.cid, c.today, f),
    docHref: orderHref,
    refType: (r) => (r.kind === 'jw' ? 'job_work_order' : 'sales_order'),
    sub: (r) => partyText(r, r.x1),
    actions: (r) => [{ kind: 'create', label: 'Plan', href: `/planning?soId=${r.id}` }],
  },
  {
    key: 'plan_to_pro',
    title: 'Plans ready for Production Order',
    head: ['Plan No.', 'Item', 'Pending', 'Status'],
    href: '/plans',
    rights: [['prodorder_create', 'entry']],
    priceForm: null,
    query: (c, f) => planToProSql(c.cid, c.today, f),
    docHref: (r) => docNavPage('plan', r.id),
    refType: () => 'plan',
    sub: (r) =>
      withCode(
        r,
        r.x3 === 'jw' ? 'JWSO' : 'SO',
        r.x2,
        r.x1 ? docNavPage(r.x3 === 'jw' ? 'job-work-order' : 'sales-order', r.x1) : null,
      ),
    actions: (r) => [
      {
        kind: 'create',
        label: 'Create Production Order',
        href: `/production-orders/new?planId=${r.id}&planCode=${enc(r.code)}`,
      },
    ],
  },
  {
    key: 'ops_ready',
    title: 'Ready for You',
    head: ['JC No.', 'Item', 'Available', 'Status'],
    href: '/op-entry',
    rights: [['op_entry', 'entry']],
    priceForm: null,
    query: (c, f) => opsReadySql(c.cid, c.today, f),
    docHref: jcHref,
    refType: () => 'job_card',
    sub: opText,
    actions: (r) => [
      {
        kind: 'start',
        label: 'Start Operation',
        href: `/op-entry?jc=${enc(r.code)}&op=${r.x1 ?? ''}&mode=start`,
      },
    ],
  },
  {
    key: 'ops_running',
    title: 'Running now',
    head: ['JC No.', 'Item', 'Completed', 'Status'],
    href: '/op-entry/running',
    rights: [['op_entry', 'entry']],
    priceForm: null,
    query: (c, f) => opsRunningSql(c.cid, f),
    docHref: jcHref,
    refType: () => 'job_card',
    sub: opText,
    actions: (r) => [open(jcHref(r))],
    status: (r) => runningStatus(Number(r.x1 ?? 0), r.isLate),
  },
  {
    key: 'jc_running',
    title: 'Open Job Cards',
    head: ['JC No.', 'Item', 'Order Qty', 'Status'],
    href: '/job-cards',
    rights: [['jc_create', 'view']],
    priceForm: null,
    query: (c, f) => jcRunningSql(c.cid, c.today, f),
    docHref: jcHref,
    refType: () => 'job_card',
    sub: (r) => [{ text: `${r.x1 ?? 0} of ${r.x2 ?? 0} ops open` }],
    actions: (r) => [open(jcHref(r))],
  },
  {
    key: 'po_overdue',
    title: 'Overdue POs',
    head: ['PO No.', 'Item', 'Pending', 'Status'],
    href: '/purchase-orders',
    rights: [['po_create', 'view']],
    priceForm: 'po_create',
    query: (c, f) => poOverdueSql(c.cid, c.today, f),
    docHref: poHref,
    refType: () => 'purchase_order',
    sub: (r) => partyText(r),
    actions: (r) => [open(poHref(r))],
  },
  {
    key: 'bom_pending',
    title: 'BOMs needed',
    head: ['SO No.', 'Item', 'Order Qty', 'Status'],
    href: '/bom-masters',
    rights: [['bom_create', 'entry']],
    priceForm: null,
    query: (c, f) => bomPendingSql(c.cid, c.today, f),
    docHref: (r) => docNavPage('sales-order', r.id),
    refType: () => 'sales_order',
    sub: (r) => partyText(r, r.x1),
    actions: () => [{ kind: 'create', label: 'Create BOM', href: '/bom-masters/new' }],
  },
  {
    key: 'capa_mine',
    title: 'My CAPAs',
    head: ['CAPA No.', 'Item', 'Qty', 'Status'],
    href: '/nc-register?tab=capa',
    rights: [
      ['capa_create', 'edit'],
      ['nc_dispose', 'view'],
    ],
    priceForm: null,
    query: (c, f) => capaMineSql(c.cid, c.today, c.myName, f),
    docHref: (r) => `/nc-register?tab=capa&capa=${enc(r.code)}`,
    refType: () => 'capa',
    sub: (r) => [{ text: [r.x1 && `${r.x1} pending`, r.x2].filter(Boolean).join(' · ') }],
    actions: (r) => [open(`/nc-register?tab=capa&capa=${enc(r.code)}`, 'Continue')],
  },
  {
    // ADR-252 — QC entries saved without their report (report_required, D8).
    key: 'qc_report_missing',
    title: 'Reports to upload',
    head: ['JC No.', 'Item', 'Accepted', 'Status'],
    href: '/qc-docs?view=dossier',
    rights: [['qcdocs_upload', 'entry']],
    priceForm: null,
    query: (c, f) => qcReportMissingSql(c.cid, f),
    docHref: jcHref,
    refType: () => 'job_card',
    sub: (r) => [
      {
        text: [
          r.party,
          r.x3 && `POL ${r.x3}`,
          `Accepted ${r.qty ?? 0}`,
          r.docDate && shortDate(r.docDate),
        ]
          .filter(Boolean)
          .join(' · '),
      },
    ],
    // No order behind the card (a standalone JC): open the card instead.
    actions: (r) =>
      r.x1
        ? [
            {
              kind: 'create',
              label: 'Upload report',
              href: `/qc-docs?view=dossier&kind=${r.kind === 'jwso' ? 'jwso' : 'so'}&orderId=${r.x1}&lineId=${r.x2 ?? ''}`,
            },
          ]
        : [open(jcHref(r))],
  },
];

/** Waiting-for-approval sources (Sent for approval block) — not home lists. */
export const APPROVAL_DEFS: Record<'pr_pending' | 'po_draft', ListDef> = {
  pr_pending: {
    ...LIST_DEFS.find((d) => d.key === 'pr_to_po')!,
    key: 'pr_pending',
    rights: [['pr_create', 'approve']],
    query: (c, f) => prPendingSql(c.cid, c.today, f),
    actions: () => [],
  },
  po_draft: {
    ...LIST_DEFS.find((d) => d.key === 'po_overdue')!,
    key: 'po_draft',
    rights: [['po_create', 'approve']],
    query: (c, f) => poDraftSql(c.cid, c.today, f),
    actions: () => [],
  },
};

export const listDef = (key: string): ListDef | undefined => LIST_DEFS.find((d) => d.key === key);

export const defDept = (d: ListDef): string =>
  ACCESS_FORMS.find((f) => f.key === d.rights[0]![0])?.dept ?? 'tasks';

/** Does the caller hold every right this list needs? */
export function holdsRights(a: DashAccess, d: ListDef): boolean {
  return d.rights.every(([form, action]) => hasTick(a, form, action));
}

/** Approvals block: shown to whoever may decide PRs, POs or log entries —
 *  the same ticks getApprovalInbox itself checks per section. */
export function holdsAnyApprove(a: DashAccess): boolean {
  return (
    hasTick(a, 'pr_create', 'approve') ||
    hasTick(a, 'po_create', 'approve') ||
    hasTick(a, 'op_entry', 'approve') ||
    hasTick(a, 'qc_submit', 'approve')
  );
}

/** The lists this caller may see, in registry order. */
export function visibleListDefs(a: DashAccess): ListDef[] {
  return LIST_DEFS.filter((d) => holdsRights(a, d));
}

/** Keep only actions whose page opens for the caller; first one per kind. A
 *  remind (no href) is decided by its caller and always passes here. */
export function filterActions(a: DashAccess, actions: readonly DashAction[]): DashAction[] {
  const seen = new Set<string>();
  const out: DashAction[] = [];
  for (const act of actions) {
    if (seen.has(act.kind)) continue;
    if (act.href !== null && !canSeeLink(a, null, act.href)) continue;
    seen.add(act.kind);
    out.push(act);
  }
  return out;
}

export interface RowCtx {
  a: DashAccess;
  today: string;
  userId: string;
  /** Price right per form, decided once per request (canSeeFormPrice). */
  showMoney: ReadonlySet<AccessFormKey>;
}

export function toDashRow(
  d: ListDef,
  r: RawRow,
  ctx: RowCtx,
  opts: { withActions: boolean; extra?: DashAction[]; sub?: DashText } = { withActions: true },
): DashRow {
  const { statusLabel, tone } = d.status ? d.status(r) : statusFor(r.dueDate, r.docDate, ctx.today);
  const candidates: DashAction[] = [
    ...(opts.withActions ? d.actions(r).map((c) => ({ ...c, taskFor: null })) : []),
    ...(opts.extra ?? []),
  ];
  return {
    key: `${d.key}:${r.rowKey}`,
    docCode: r.code,
    docHref: d.docHref(r),
    sub: opts.sub ?? d.sub(r),
    itemCode: r.itemCode,
    itemName: r.itemName,
    qty: r.qty,
    uom: r.uom,
    statusLabel,
    tone,
    mine: d.key === 'capa_mine' || r.createdBy === ctx.userId,
    amount: d.priceForm && ctx.showMoney.has(d.priceForm) ? r.amount : null,
    actions: filterActions(ctx.a, candidates),
  };
}
