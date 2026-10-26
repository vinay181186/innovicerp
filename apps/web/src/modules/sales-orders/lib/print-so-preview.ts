// SO Preview (SO Master ⋯ → Preview) — the ONE model the preview box and its
// print / PDF are both drawn from, so the two can never disagree.
//
// Header: the SO detail (GET /sales-orders/:id). Per line: every document the
// line has made, read from the Level Matrix (GET /flow-views/sales-orders/:id/
// level-matrix) — Route Card · Plan · PRO → JC · OSP PR/PO/DC/GRN · Dispatch ·
// Invoice — with its status, and "Pending" where none exists yet. No money.
//
// Status words follow the app's StatusBadge labels (ui/core/StatusBadge.tsx
// LABELS, which that file does not export) for the kinds used here; anything
// else falls back to the code in Title Case. Route Card uses the shared
// ROUTE_CARD_APPROVAL_LABEL (ADR-253).

import { ROUTE_CARD_APPROVAL_LABEL, type Company, type SalesOrderDetail } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { esc, fmtDate } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';
import { soNoWithInternal } from '@/lib/so-number';
import type { StatusKind } from '@/ui/core';
import type {
  LevelJobCard,
  LevelLineDoc,
  LevelMatrixResponse,
  LevelOspDoc,
  LevelSoLine,
} from '@/modules/flow-views/types';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from './so-status-label';

// ─── Status words ───────────────────────────────────────────────────────────

const LABELS: Partial<Record<StatusKind, Record<string, string>>> = {
  jc: { qc_pending: 'QC Pending', complete: 'Completed', no_ops: 'No Operations' },
  pr: { po_created: 'PO Created' },
  po: { partial: 'Partly Received', qc_pending: 'QC Pending' },
  prodorder: { partially_closed: 'Partly Closed', short_closed: 'Short Closed' },
  grnqc: { pending: 'QC Pending', in_progress: 'QC In Progress', completed: 'QC Cleared' },
  invoice: { partial: 'Partly Paid', cancelled: 'Cancelled' },
  plan: { jc_created: 'JC Created', pr_created: 'PR Created', complete: 'Completed' },
  planderived: {
    route_card_pending: 'RC Pending',
    route_card_approval_pending: 'RC Awaiting Approval',
    gen_production_order: 'Ready for Production Order',
    in_production: 'In Production',
    production_complete: 'Completed',
  },
  doc: { short_closed: 'Short Closed' },
};

function titleCase(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function previewStatusLabel(kind: StatusKind, status: string | null | undefined): string {
  if (!status) return '';
  const key = status.toLowerCase().replace(/ /g, '_');
  if (kind === 'so') return SO_STATUS_LABEL[key as keyof typeof SO_STATUS_LABEL] ?? titleCase(key);
  return LABELS[kind]?.[key] ?? titleCase(status);
}

// ─── The model ──────────────────────────────────────────────────────────────

export type PreviewDocKind =
  | 'route-card'
  | 'plan'
  | 'pro'
  | 'jc'
  | 'pr'
  | 'po'
  | 'dc'
  | 'grn'
  | 'dispatch'
  | 'invoice';

export interface PreviewDoc {
  kind: PreviewDocKind;
  id: string;
  code: string;
  /** Small word before the number ("JC", "PO", …); none for the row's own doc. */
  tag?: string;
  /** Draw "→" before the tag (a PRO's Job Card). */
  arrow?: boolean;
  /** The item this document is for — only where it differs from the line's (equipment BOM parts). */
  itemCode?: string | null;
  badgeKind: StatusKind;
  status: string | null;
  statusLabel: string;
  /** Trailing note, e.g. "(20)" for a dispatched / billed qty or "Rev 2". */
  note?: string;
}

export type PreviewRowLabel = 'Route Card' | 'Plan' | 'PRO' | 'JC' | 'OSP' | 'Dispatch' | 'Invoice';

export interface PreviewRow {
  label: PreviewRowLabel;
  /** Empty = "Pending" (not generated yet). */
  docs: PreviewDoc[];
}

export interface PreviewLine {
  id: string;
  lineNo: number;
  pol: string | null;
  itemCode: string;
  partName: string;
  orderQty: number;
  dispatchedQty: number;
  billedQty: number;
  statusKind: StatusKind;
  status: string;
  statusLabel: string;
  rows: PreviewRow[];
  /** Nothing generated at all → drawn as one "… Pending · … Pending" line. */
  nothingYet: boolean;
}

export interface PreviewHeader {
  soNo: string;
  status: string;
  statusLabel: string;
  customer: string | null;
  clientPoNo: string | null;
  soDate: string | null;
  dueDate: string | null;
  type: string;
  raisedBy: string | null;
  remarks: string | null;
}

export function buildPreviewHeader(so: SalesOrderDetail): PreviewHeader {
  // The SO has no header due date — the earliest live line's, as the list's
  // Due Date column shows it.
  const due = so.lines
    .filter((l) => l.status !== 'cancelled' && l.dueDate)
    .map((l) => l.dueDate as string)
    .sort()[0];
  return {
    soNo: soNoWithInternal(so.code, so.internalSoNo),
    status: so.status,
    statusLabel: previewStatusLabel('so', so.status),
    customer: so.customerName,
    clientPoNo: so.clientPoNo,
    soDate: so.soDate,
    dueDate: due ?? null,
    type: SO_TYPE_LABEL[so.type],
    raisedBy: so.createdByName,
    remarks: so.remarks?.trim() ? so.remarks : null,
  };
}

const OSP_TAG: Record<LevelOspDoc['kind'], string> = { pr: 'PR', po: 'PO', dc: 'DC', grn: 'GRN' };
const OSP_BADGE: Record<LevelOspDoc['kind'], StatusKind> = {
  pr: 'pr',
  po: 'po',
  dc: 'dc',
  grn: 'grnqc',
};

function jcDoc(j: LevelJobCard, showItem: boolean, asPart: boolean): PreviewDoc {
  return {
    kind: 'jc',
    id: j.id,
    code: j.code,
    ...(asPart ? { tag: 'JC', arrow: true } : {}),
    itemCode: showItem ? j.itemCode : null,
    badgeKind: 'jc',
    status: j.status,
    statusLabel: previewStatusLabel('jc', j.status),
  };
}

function lineDoc(kind: 'dispatch' | 'invoice', d: LevelLineDoc): PreviewDoc {
  const badgeKind: StatusKind = kind === 'invoice' ? 'invoice' : 'doc';
  return {
    kind,
    id: d.id,
    code: d.code,
    badgeKind,
    status: d.status,
    statusLabel: previewStatusLabel(badgeKind, d.status),
    note: `(${d.qty})`,
  };
}

function buildLine(l: LevelSoLine, revision: string | null, equipment: boolean): PreviewLine {
  // Fields added to the Level Matrix with this preview; read defensively so an
  // API not yet carrying them shows "Pending" instead of failing.
  const dispatches = l.dispatches ?? [];
  const invoices = l.invoices ?? [];
  const routeCard = l.routeCard ?? null;
  const rows: PreviewRow[] = [];

  // Route Card — the line item's live card; on an equipment line (BOM on the
  // header) the parts' cards, as named on their PROs.
  const rcDocs: PreviewDoc[] = [];
  if (routeCard) {
    rcDocs.push({
      kind: 'route-card',
      id: routeCard.id,
      code: routeCard.code,
      badgeKind: 'doc',
      status: routeCard.approvalStatus,
      statusLabel: ROUTE_CARD_APPROVAL_LABEL[routeCard.approvalStatus],
    });
  } else if (equipment) {
    const seen = new Set<string>();
    for (const p of l.productionOrders) {
      if (!p.routeCardId || !p.routeCardCode || seen.has(p.routeCardId)) continue;
      seen.add(p.routeCardId);
      rcDocs.push({
        kind: 'route-card',
        id: p.routeCardId,
        code: p.routeCardCode,
        itemCode: p.itemCode,
        badgeKind: 'doc',
        status: null,
        statusLabel: '',
        ...(p.routeCardRevision != null ? { note: `Rev ${p.routeCardRevision}` } : {}),
      });
    }
  }
  rows.push({ label: 'Route Card', docs: rcDocs });

  rows.push({
    label: 'Plan',
    docs: l.plans.map((p) => {
      const badgeKind: StatusKind = p.derivedStatus ? 'planderived' : 'plan';
      const status = p.derivedStatus ?? p.planStatus;
      return {
        kind: 'plan' as const,
        id: p.id,
        code: p.code,
        badgeKind,
        status,
        statusLabel: previewStatusLabel(badgeKind, status),
      };
    }),
  });

  // PRO → its Job Card(s). Several PROs = several PRO rows.
  if (l.productionOrders.length === 0) rows.push({ label: 'PRO', docs: [] });
  for (const p of l.productionOrders) {
    const jcs = l.jobCards.filter((j) => j.productionOrderId === p.id);
    rows.push({
      label: 'PRO',
      docs: [
        {
          kind: 'pro',
          id: p.id,
          code: p.code,
          itemCode: equipment ? p.itemCode : null,
          badgeKind: 'prodorder',
          status: p.status,
          statusLabel: previewStatusLabel('prodorder', p.status),
        },
        ...jcs.map((j) => jcDoc(j, false, true)),
      ],
    });
  }
  // A PRO with no card yet shows "→ JC Pending" on screen (see the modal).
  // Cards with no PRO (raised on the line directly) are their own JC rows.
  const loose = l.jobCards.filter(
    (j) => !j.productionOrderId || !l.productionOrders.some((p) => p.id === j.productionOrderId),
  );
  for (const j of loose) rows.push({ label: 'JC', docs: [jcDoc(j, equipment, false)] });
  if (l.productionOrders.length === 0 && loose.length === 0) rows.push({ label: 'JC', docs: [] });

  // OSP — one row per card that has outsource documents.
  const ospCards = l.jobCards.filter((j) => j.ospDocs.length > 0);
  for (const j of ospCards) {
    rows.push({
      label: 'OSP',
      docs: j.ospDocs.map((d) => {
        const badgeKind = OSP_BADGE[d.kind];
        return {
          kind: d.kind,
          id: d.id,
          code: d.code,
          tag: OSP_TAG[d.kind],
          badgeKind,
          status: d.status,
          statusLabel: previewStatusLabel(badgeKind, d.status),
          ...(ospCards.length > 1 ? { note: `(${j.code})` } : {}),
        };
      }),
    });
  }

  rows.push({ label: 'Dispatch', docs: dispatches.map((d) => lineDoc('dispatch', d)) });
  rows.push({ label: 'Invoice', docs: invoices.map((d) => lineDoc('invoice', d)) });

  const nothingYet =
    !routeCard &&
    rcDocs.length === 0 &&
    l.plans.length === 0 &&
    l.productionOrders.length === 0 &&
    l.jobCards.length === 0 &&
    dispatches.length === 0 &&
    invoices.length === 0;

  const shortClosed = Boolean(l.shortClosedAt);
  return {
    id: l.id,
    lineNo: l.lineNo,
    pol: l.clientPoLineNo,
    itemCode: itemCodeWithRev(l.itemCode, revision),
    partName: l.partName,
    orderQty: l.orderQty,
    dispatchedQty: l.dispatchedQty,
    billedQty: l.billedQty,
    statusKind: shortClosed ? 'doc' : 'so',
    status: shortClosed ? 'short_closed' : l.status,
    statusLabel: shortClosed ? 'Short Closed' : previewStatusLabel('so', l.status),
    rows,
    nothingYet,
  };
}

export function buildPreviewLines(
  so: SalesOrderDetail,
  matrix: LevelMatrixResponse,
): PreviewLine[] {
  const rev = new Map(so.lines.map((l) => [l.id, l.revision]));
  const equipment = so.type === 'equipment';
  return matrix.lines.map((l) => buildLine(l, rev.get(l.id) ?? null, equipment));
}

/** The rows drawn for a line with nothing generated yet. */
export const NOTHING_YET_LABELS: PreviewRowLabel[] = ['Route Card', 'Plan', 'PRO', 'JC'];

// ─── Print / PDF ────────────────────────────────────────────────────────────

function docHtml(d: PreviewDoc): string {
  const parts: string[] = [];
  if (d.arrow) parts.push('&rarr;');
  if (d.tag) parts.push(`<span style="color:#6b7280">${esc(d.tag)}</span>`);
  parts.push(`<b style="font-family:monospace">${esc(d.code)}</b>`);
  if (d.itemCode) parts.push(`<span style="color:#6b7280">[${esc(d.itemCode)}]</span>`);
  if (d.statusLabel) parts.push(esc(d.statusLabel));
  if (d.note) parts.push(esc(d.note));
  return parts.join(' ');
}

function rowCellHtml(r: PreviewRow): string {
  if (r.docs.length === 0) return '<span style="color:#9ca3af">Pending</span>';
  const html = r.docs.map(docHtml).join(r.label === 'OSP' ? ' &middot; ' : ' ');
  // A PRO with no card yet.
  if (r.label === 'PRO' && !r.docs.some((d) => d.kind === 'jc'))
    return `${html} &rarr; <span style="color:#6b7280">JC</span> <span style="color:#9ca3af">Pending</span>`;
  return html;
}

export function lineHeadingText(l: PreviewLine): string {
  const bits = [
    `Ln ${l.lineNo}`,
    `POL ${l.pol ?? '—'}`,
    l.itemCode,
    `Order ${l.orderQty}`,
    `Disp ${l.dispatchedQty}`,
    `Billed ${l.billedQty}`,
    l.statusLabel,
  ];
  return bits.join(' · ');
}

export function printSoPreview(args: {
  header: PreviewHeader;
  lines: PreviewLine[];
  company: Company | null | undefined;
  /** The SO No. — names the PDF "<SO No.> Preview". */
  soCode: string;
}): boolean {
  const { header: h, lines, company, soCode } = args;
  const box = (lbl: string, val: string | null): string =>
    `<div class="info-box"><div class="info-lbl">${esc(lbl)}</div><div class="info-val" style="font-size:12px">${esc(val || '—')}</div></div>`;

  const sections = lines
    .map((l) => {
      const heading = `<h2>${esc(lineHeadingText(l))} <span style="font-weight:400;color:#555">${esc(l.partName)}</span></h2>`;
      if (l.nothingYet) {
        return `${heading}<div style="font-size:11px;color:#6b7280;margin:0 0 10px 8px">${NOTHING_YET_LABELS.map(
          (x) => `${esc(x)} Pending`,
        ).join(' &middot; ')}</div>`;
      }
      const body = l.rows
        .map(
          (r) =>
            `<tr><td style="width:90px;color:#6b7280;font-weight:700">${esc(r.label)}</td><td>${rowCellHtml(r)}</td></tr>`,
        )
        .join('');
      return `${heading}<table><tbody>${body}</tbody></table>`;
    })
    .join('');

  const body = `
    <div class="doc-title"><h1>SALES ORDER PREVIEW &mdash; ${esc(h.soNo)}</h1><span class="print-meta">SO Status: ${esc(h.statusLabel)} &middot; ${printedMeta()}</span></div>
    <div class="info-grid" style="grid-template-columns:repeat(3,1fr)">
      ${box('Customer', h.customer)}
      ${box('Client PO No.', h.clientPoNo)}
      ${box('SO Date', h.soDate ? fmtDate(h.soDate) : null)}
      ${box('Due Date', h.dueDate ? fmtDate(h.dueDate) : null)}
      ${box('SO Type', h.type)}
      ${box('Raised By', h.raisedBy)}
    </div>
    <div class="info-box" style="margin-bottom:14px"><div class="info-lbl">SO Remarks</div><div style="font-size:12px;white-space:pre-wrap">${esc(h.remarks ?? '—')}</div></div>
    ${sections || '<div style="color:#aaa;text-align:center">No lines on this SO.</div>'}`;

  return printWindow({ title: 'SO Preview', body, company, fileName: `${soCode} Preview` });
}
