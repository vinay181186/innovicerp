// Source catalog for the ad-hoc report builder (T-041b).
//
// Each source pairs:
//   1. A SourceDescriptor (key, label, fields[]) — what the UI shows in the
//      Available Fields list, and what the spec validator whitelists.
//   2. A `baseSelect` SQL fragment that joins the underlying tables and
//      aliases columns to the descriptor's field keys. The runner wraps
//      this in a CTE then layers filters / sort / group on top — so each
//      source only worries about producing the right column shape.
//
// Adding a source = drop a new entry below + add tests. No other change.

import { sql, type SQL } from 'drizzle-orm';
import type { SourceDescriptor } from '@innovic/shared';

export interface SourceQueryContext {
  companyId: string;
}

export interface RegisteredSource {
  descriptor: SourceDescriptor;
  /** Returns a parameterised SELECT that returns rows shaped exactly by
   *  descriptor.fields[]. Company isolation is applied here so the runner
   *  doesn't have to know table layouts. */
  baseSelect: (ctx: SourceQueryContext) => SQL;
}

// ─── Sales orders (lines flattened with header + item + client joins) ────

const salesOrdersSource: RegisteredSource = {
  descriptor: {
    sourceKey: 'sales-orders',
    label: 'Sales orders',
    description: 'Customer orders with line-level item, qty, rate, due date.',
    group: 'Sales',
    fields: [
      { key: 'so_code', label: 'SO No.', type: 'text', filterable: true, groupable: true },
      { key: 'so_date', label: 'SO Date', type: 'date', filterable: true, groupable: true },
      { key: 'client_code', label: 'Client', type: 'text', filterable: true, groupable: true },
      { key: 'client_name', label: 'Client name', type: 'text', filterable: true, groupable: true },
      { key: 'so_status', label: 'SO Status', type: 'text', filterable: true, groupable: true },
      { key: 'so_type', label: 'SO Type', type: 'text', filterable: true, groupable: true },
      { key: 'line_no', label: 'Line No.', type: 'number', filterable: true, groupable: false },
      { key: 'item_code', label: 'Item Code', type: 'text', filterable: true, groupable: true },
      { key: 'item_name', label: 'Item name', type: 'text', filterable: true, groupable: true },
      { key: 'qty', label: 'Order qty', type: 'number', filterable: true, groupable: false },
      { key: 'uom', label: 'UOM', type: 'text', filterable: true, groupable: true },
      { key: 'rate', label: 'Rate', type: 'number', filterable: true, groupable: false },
      { key: 'amount', label: 'Amount', type: 'number', filterable: true, groupable: false },
      { key: 'due_date', label: 'Due date', type: 'date', filterable: true, groupable: true },
      { key: 'line_status', label: 'Line status', type: 'text', filterable: true, groupable: true },
    ],
  },
  baseSelect: ({ companyId }) => sql`
    SELECT
      so.code                           AS so_code,
      so.so_date                        AS so_date,
      cl.code                           AS client_code,
      COALESCE(cl.name, so.customer_name) AS client_name,
      so.status::text                   AS so_status,
      so.type::text                     AS so_type,
      sol.line_no                       AS line_no,
      COALESCE(it.code, sol.item_code_text) AS item_code,
      COALESCE(it.name, sol.part_name)  AS item_name,
      sol.order_qty                     AS qty,
      sol.uom::text                     AS uom,
      sol.rate                          AS rate,
      (sol.order_qty * sol.rate)::numeric(14, 2) AS amount,
      sol.due_date                      AS due_date,
      sol.status::text                  AS line_status
    FROM public.sales_order_lines sol
    JOIN public.sales_orders so ON so.id = sol.sales_order_id
    LEFT JOIN public.items it ON it.id = sol.item_id
    LEFT JOIN public.clients cl ON cl.id = so.client_id
    WHERE sol.company_id = ${companyId}::uuid
      AND sol.deleted_at IS NULL
      AND so.deleted_at IS NULL
  `,
};

// ─── Purchase orders (lines flattened with header + vendor + item) ───────

const purchaseOrdersSource: RegisteredSource = {
  descriptor: {
    sourceKey: 'purchase-orders',
    label: 'Purchase orders',
    description: 'Procurement POs with line-level vendor, item, qty + received qty.',
    group: 'Procurement',
    fields: [
      { key: 'po_code', label: 'PO No.', type: 'text', filterable: true, groupable: true },
      { key: 'po_date', label: 'PO Date', type: 'date', filterable: true, groupable: true },
      { key: 'po_status', label: 'Status', type: 'text', filterable: true, groupable: true },
      { key: 'po_type', label: 'PO Type', type: 'text', filterable: true, groupable: true },
      { key: 'vendor_code', label: 'Vendor', type: 'text', filterable: true, groupable: true },
      { key: 'vendor_name', label: 'Vendor name', type: 'text', filterable: true, groupable: true },
      { key: 'line_no', label: 'Line No.', type: 'number', filterable: true, groupable: false },
      {
        key: 'item_code',
        label: 'Item Code',
        type: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'item_name',
        label: 'Item name',
        type: 'text',
        filterable: true,
        groupable: true,
      },
      { key: 'qty', label: 'PO qty', type: 'number', filterable: true, groupable: false },
      { key: 'rate', label: 'Rate', type: 'number', filterable: true, groupable: false },
      {
        key: 'received_qty',
        label: 'Received qty',
        type: 'number',
        filterable: true,
        groupable: false,
      },
      {
        key: 'pending_qty',
        label: 'Pending qty',
        type: 'number',
        filterable: true,
        groupable: false,
      },
      { key: 'due_date', label: 'Due date', type: 'date', filterable: true, groupable: true },
    ],
  },
  baseSelect: ({ companyId }) => sql`
    SELECT
      po.code                                       AS po_code,
      po.po_date                                    AS po_date,
      po.status::text                               AS po_status,
      po.po_type::text                              AS po_type,
      COALESCE(vd.code, po.vendor_code_text)        AS vendor_code,
      vd.name                                       AS vendor_name,
      pol.line_no                                   AS line_no,
      COALESCE(it.code, pol.item_code_text)         AS item_code,
      COALESCE(it.name, pol.item_name)              AS item_name,
      pol.qty                                       AS qty,
      pol.rate                                      AS rate,
      pol.received_qty                              AS received_qty,
      (pol.qty - pol.received_qty)::numeric(14, 2)  AS pending_qty,
      pol.due_date                                  AS due_date
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
    LEFT JOIN public.items it ON it.id = pol.item_id
    LEFT JOIN public.vendors vd ON vd.id = po.vendor_id
    WHERE pol.company_id = ${companyId}::uuid
      AND pol.deleted_at IS NULL
      AND po.deleted_at IS NULL
  `,
};

// ─── Job cards (with item + computed status from v_jc_status) ────────────

const jobCardsSource: RegisteredSource = {
  descriptor: {
    sourceKey: 'job-cards',
    label: 'Job cards',
    description: 'Production job cards with item, qty, computed status, source SO link.',
    group: 'Production',
    fields: [
      { key: 'jc_code', label: 'JC No.', type: 'text', filterable: true, groupable: true },
      { key: 'jc_date', label: 'JC Date', type: 'date', filterable: true, groupable: true },
      { key: 'item_code', label: 'Item Code', type: 'text', filterable: true, groupable: true },
      { key: 'item_name', label: 'Item name', type: 'text', filterable: true, groupable: true },
      { key: 'qty', label: 'Order qty', type: 'number', filterable: true, groupable: false },
      { key: 'priority', label: 'Priority', type: 'text', filterable: true, groupable: true },
      {
        key: 'computed_status',
        label: 'Status',
        type: 'text',
        filterable: true,
        groupable: true,
      },
      { key: 'total_ops', label: 'Total ops', type: 'number', filterable: true, groupable: false },
      { key: 'done_ops', label: 'Done ops', type: 'number', filterable: true, groupable: false },
      { key: 'due_date', label: 'Due date', type: 'date', filterable: true, groupable: true },
      {
        key: 'source_so_code',
        label: 'Source SO',
        type: 'text',
        filterable: true,
        groupable: true,
      },
    ],
  },
  baseSelect: ({ companyId }) => sql`
    SELECT
      jc.code              AS jc_code,
      jc.jc_date           AS jc_date,
      it.code              AS item_code,
      it.name              AS item_name,
      jc.order_qty         AS qty,
      jc.priority::text    AS priority,
      v.computed_status    AS computed_status,
      v.total_ops          AS total_ops,
      v.done_ops           AS done_ops,
      jc.due_date          AS due_date,
      so.code              AS source_so_code
    FROM public.job_cards jc
    JOIN public.items it ON it.id = jc.item_id
    LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
    LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
    LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
    WHERE jc.company_id = ${companyId}::uuid
      AND jc.deleted_at IS NULL
  `,
};

// ─── Items + on-hand stock (joins v_item_stock) ──────────────────────────

const itemsStockSource: RegisteredSource = {
  descriptor: {
    sourceKey: 'items-stock',
    label: 'Items + on-hand stock',
    description: 'Item master joined with current on-hand qty (zero-stock items included).',
    group: 'Inventory',
    fields: [
      { key: 'code', label: 'Item Code', type: 'text', filterable: true, groupable: true },
      { key: 'name', label: 'Item name', type: 'text', filterable: true, groupable: true },
      { key: 'item_type', label: 'Type', type: 'text', filterable: true, groupable: true },
      { key: 'material', label: 'Material', type: 'text', filterable: true, groupable: true },
      { key: 'uom', label: 'UOM', type: 'text', filterable: true, groupable: true },
      { key: 'on_hand', label: 'On hand', type: 'number', filterable: true, groupable: false },
      { key: 'drawing_no', label: 'Drawing No.', type: 'text', filterable: true, groupable: true },
      { key: 'revision', label: 'Revision', type: 'text', filterable: true, groupable: true },
      { key: 'hsn_code', label: 'HSN code', type: 'text', filterable: true, groupable: true },
    ],
  },
  baseSelect: ({ companyId }) => sql`
    SELECT
      it.code         AS code,
      it.name         AS name,
      it.item_type::text AS item_type,
      it.material     AS material,
      it.uom::text    AS uom,
      COALESCE(s.on_hand_qty, 0)::numeric(14, 2) AS on_hand,
      it.drawing_no   AS drawing_no,
      it.revision     AS revision,
      it.hsn_code     AS hsn_code
    FROM public.items it
    LEFT JOIN public.v_item_stock s ON s.item_id = it.id
    WHERE it.company_id = ${companyId}::uuid
      AND it.deleted_at IS NULL
  `,
};

// ─── NC register (with JC + item joins) ──────────────────────────────────

const ncRegisterSource: RegisteredSource = {
  descriptor: {
    sourceKey: 'nc-register',
    label: 'NC register',
    description: 'Non-conformance entries with JC, item, reason category, status, disposition.',
    group: 'Quality',
    fields: [
      { key: 'nc_code', label: 'NC No.', type: 'text', filterable: true, groupable: true },
      { key: 'nc_date', label: 'NC Date', type: 'date', filterable: true, groupable: true },
      { key: 'jc_code', label: 'JC No.', type: 'text', filterable: true, groupable: true },
      { key: 'item_code', label: 'Item Code', type: 'text', filterable: true, groupable: true },
      { key: 'item_name', label: 'Item name', type: 'text', filterable: true, groupable: true },
      {
        key: 'rejected_qty',
        label: 'Rejected qty',
        type: 'number',
        filterable: true,
        groupable: false,
      },
      { key: 'reason_category', label: 'Reason', type: 'text', filterable: true, groupable: true },
      { key: 'status', label: 'Status', type: 'text', filterable: true, groupable: true },
      { key: 'disposition', label: 'Disposition', type: 'text', filterable: true, groupable: true },
      { key: 'op_seq', label: 'Op seq', type: 'number', filterable: true, groupable: true },
      { key: 'reported_by', label: 'Reported by', type: 'text', filterable: true, groupable: true },
    ],
  },
  baseSelect: ({ companyId }) => sql`
    SELECT
      nc.code               AS nc_code,
      nc.nc_date            AS nc_date,
      jc.code               AS jc_code,
      it.code               AS item_code,
      it.name               AS item_name,
      nc.rejected_qty       AS rejected_qty,
      nc.reason_category::text AS reason_category,
      nc.status::text       AS status,
      nc.disposition::text  AS disposition,
      nc.op_seq             AS op_seq,
      nc.reported_by_text   AS reported_by
    FROM public.nc_register nc
    JOIN public.job_cards jc ON jc.id = nc.job_card_id
    JOIN public.items it ON it.id = nc.item_id
    WHERE nc.company_id = ${companyId}::uuid
      AND nc.deleted_at IS NULL
  `,
};

export const SOURCES: Record<string, RegisteredSource> = {
  [salesOrdersSource.descriptor.sourceKey]: salesOrdersSource,
  [purchaseOrdersSource.descriptor.sourceKey]: purchaseOrdersSource,
  [jobCardsSource.descriptor.sourceKey]: jobCardsSource,
  [itemsStockSource.descriptor.sourceKey]: itemsStockSource,
  [ncRegisterSource.descriptor.sourceKey]: ncRegisterSource,
};

export function listSourceDescriptors(): SourceDescriptor[] {
  return Object.values(SOURCES).map((s) => s.descriptor);
}

export function getSource(sourceKey: string): RegisteredSource | undefined {
  return SOURCES[sourceKey];
}
