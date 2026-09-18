// Global Search registry, part 1: the document kinds that have their own
// detail page (sales order … JW DC outward). See kinds.ts for the shape.
// Column names verified against apps/api/src/db/schema.ts.

import { sql } from 'drizzle-orm';
import { type KindMeta, opLines, pair, ref, soRef } from './kinds';

export const DOC_KINDS: readonly KindMeta[] = [
  {
    kind: 'sales-order',
    from: sql`public.sales_orders t LEFT JOIN public.clients c ON c.id = t.client_id`,
    docNo: sql`t.code`,
    date: sql`t.so_date::date`,
    party: sql`COALESCE(c.name, t.customer_name)`,
    text: [sql`t.client_po_no`, sql`t.remarks`, sql`t.cost_center`],
    lines: {
      from: sql`public.sales_order_lines l`,
      fk: sql`l.sales_order_id`,
      display: pair(sql`l.item_code_text`, sql`l.part_name`),
      match: [
        sql`l.item_code_text`,
        sql`l.part_name`,
        sql`l.material`,
        sql`l.drawing_no`,
        sql`l.client_po_line_no`,
      ],
      order: sql`l.line_no`,
      qty: sql`l.order_qty`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'job-work-order',
    from: sql`public.job_work_orders t LEFT JOIN public.clients c ON c.id = t.client_id`,
    docNo: sql`t.code`,
    date: sql`t.jw_date::date`,
    party: sql`COALESCE(c.name, t.customer_name)`,
    text: [sql`t.client_po_no`, sql`t.remarks`, sql`t.client_material`],
    lines: {
      from: sql`public.job_work_order_lines l`,
      fk: sql`l.job_work_order_id`,
      display: pair(sql`l.item_code_text`, sql`l.part_name`),
      match: [sql`l.item_code_text`, sql`l.part_name`, sql`l.material`, sql`l.drawing_no`],
      order: sql`l.line_no`,
      qty: sql`l.order_qty`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'purchase-request',
    from: sql`public.purchase_requests t
      LEFT JOIN public.vendors v ON v.id = t.vendor_id
      LEFT JOIN public.items i ON i.id = t.item_id
      LEFT JOIN public.purchase_orders po ON po.id = t.po_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = t.source_so_line_id
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.jc_ops jo ON jo.id = t.source_jc_op_id
      LEFT JOIN public.job_cards jc ON jc.id = jo.job_card_id`,
    docNo: sql`t.code`,
    date: sql`t.pr_date::date`,
    party: sql`COALESCE(v.name, t.vendor_code_text)`,
    text: [sql`t.operation`, sql`t.remarks`],
    shown: [sql`t.item_code_text`, sql`COALESCE(i.name, t.item_name)`],
    refs: [ref('PO', sql`po.code`), soRef(sql`so.code`), ref('JC', sql`jc.code`)],
    flatLines: [pair(sql`t.item_code_text`, sql`COALESCE(i.name, t.item_name)`)],
    qty: sql`t.qty`,
    status: sql`t.status::text`,
  },
  {
    kind: 'purchase-order',
    from: sql`public.purchase_orders t
      LEFT JOIN public.vendors v ON v.id = t.vendor_id
      LEFT JOIN public.purchase_requests pr ON pr.id = t.pr_id`,
    docNo: sql`t.code`,
    date: sql`t.po_date::date`,
    party: sql`COALESCE(v.name, t.vendor_code_text)`,
    text: [sql`t.remarks`, sql`t.approval_remarks`, sql`t.rejection_reason`],
    refs: [ref('PR', sql`COALESCE(t.pr_code_text, pr.code)`)],
    lines: {
      from: sql`public.purchase_order_lines l`,
      fk: sql`l.purchase_order_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name`),
      match: [sql`l.item_code_text`, sql`l.item_name`, sql`l.ram_remark`, sql`l.line_remarks`],
      order: sql`l.line_no`,
      qty: sql`l.qty`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'grn',
    from: sql`public.goods_receipt_notes t
      LEFT JOIN public.vendors v ON v.id = t.vendor_id
      LEFT JOIN public.purchase_orders po ON po.id = t.purchase_order_id
      LEFT JOIN public.delivery_challans dc ON dc.id = t.delivery_challan_id
      LEFT JOIN public.nc_register nc ON nc.id = t.nc_id`,
    docNo: sql`t.code`,
    date: sql`t.grn_date::date`,
    party: sql`COALESCE(v.name, t.vendor_code_text)`,
    text: [sql`t.remarks`],
    refs: [
      // GRNs against an NC carry the NC code in po_code_text — that is the NC ref, not a PO.
      ref(
        'PO',
        sql`COALESCE(po.code, CASE WHEN t.po_code_text ILIKE 'NC%' THEN NULL ELSE t.po_code_text END)`,
      ),
      ref('DC', sql`dc.code`),
      ref('NC', sql`nc.code`),
      // Skip the vendor DC no when it is just our own OSP DC (already shown as "DC …").
      ref('Vendor DC', sql`CASE WHEN t.dc_no = dc.code THEN NULL ELSE t.dc_no END`),
      ref('Inv', sql`t.invoice_no`),
    ],
    lines: {
      from: sql`public.goods_receipt_note_lines l`,
      fk: sql`l.goods_receipt_note_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name`),
      match: [sql`l.item_code_text`, sql`l.item_name`, sql`l.dc_ref_no`, sql`l.remarks`],
      order: sql`l.line_no`,
      qty: sql`l.received_qty`,
    },
    qty: null,
    status: null,
  },
  {
    kind: 'delivery-challan',
    from: sql`public.delivery_challans t
      LEFT JOIN public.vendors v ON v.id = t.vendor_id
      LEFT JOIN public.purchase_orders po ON po.id = t.purchase_order_id
      LEFT JOIN public.job_cards jc ON jc.id = t.job_card_id
      LEFT JOIN public.nc_register nc ON nc.id = t.nc_id`,
    docNo: sql`t.code`,
    date: sql`t.dc_date::date`,
    party: sql`COALESCE(v.name, t.vendor_code_text)`,
    text: [sql`t.transport`, sql`t.vehicle_no`, sql`t.reason`],
    refs: [
      // Return-to-vendor DCs carry the NC code in po_code_text — that is the NC ref, not a PO.
      ref(
        'PO',
        sql`COALESCE(po.code, CASE WHEN t.po_code_text ILIKE 'NC%' THEN NULL ELSE t.po_code_text END)`,
      ),
      soRef(sql`t.so_ref_text`),
      ref('JC', sql`jc.code`),
      ref('NC', sql`nc.code`),
    ],
    lines: {
      from: sql`public.delivery_challan_lines l`,
      fk: sql`l.delivery_challan_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name_text`),
      match: [
        sql`l.item_code_text`,
        sql`l.item_name_text`,
        sql`l.material_text`,
        sql`l.dc_remarks`,
      ],
      order: sql`l.line_no`,
      qty: sql`l.qty`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'job-card',
    from: sql`public.job_cards t
      LEFT JOIN public.items i ON i.id = t.item_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = t.source_so_line_id
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.clients c ON c.id = so.client_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = t.source_jw_line_id
      LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id
      LEFT JOIN public.clients c2 ON c2.id = jw.client_id
      LEFT JOIN public.nc_register nc ON nc.id = t.parent_nc_id
      LEFT JOIN public.job_cards pj ON pj.id = t.parent_job_card_id`,
    docNo: sql`t.code`,
    date: sql`t.jc_date::date`,
    party: sql`COALESCE(c.name, so.customer_name, c2.name, jw.customer_name)`,
    text: [sql`t.remarks`, sql`t.raw_material_grade_text`, sql`t.raw_material_size_text`],
    shown: [sql`i.code`, sql`i.name`],
    refs: [
      soRef(sql`so.code`),
      ref('JWSO', sql`jw.code`),
      ref('NC', sql`nc.code`),
      ref('Parent JC', sql`pj.code`),
    ],
    flatLines: [pair(sql`i.code`, sql`i.name`)],
    lines: opLines(sql`public.jc_ops l`, sql`l.job_card_id`, [
      sql`l.outsource_vendor_text`,
      sql`l.outsource_dc_no`,
    ]),
    qty: sql`t.order_qty`,
    status: sql`CASE WHEN t.closed_at IS NULL THEN 'open' ELSE 'closed' END`,
  },
  {
    kind: 'nc',
    from: sql`public.nc_register t
      LEFT JOIN public.job_cards jc ON jc.id = t.job_card_id
      LEFT JOIN public.delivery_challans dc ON dc.id = t.delivery_challan_id`,
    docNo: sql`t.code`,
    date: sql`t.nc_date::date`,
    party: null,
    text: [
      sql`t.operation_text`,
      sql`t.machine_code_text`,
      sql`t.operator_text`,
      sql`t.reason`,
      sql`t.disposition_remarks`,
      sql`t.disposition::text`,
    ],
    shown: [sql`t.item_code_text`, sql`t.item_name_text`],
    refs: [
      ref('JC', sql`jc.code`),
      soRef(sql`t.so_code_text`),
      ref('Rework JC', sql`t.rework_jc_code_text`),
      ref('DC', sql`dc.code`),
    ],
    flatLines: [pair(sql`t.item_code_text`, sql`t.item_name_text`)],
    qty: sql`t.rejected_qty`,
    status: sql`t.status::text`,
  },
  {
    kind: 'invoice',
    from: sql`public.invoices t
      LEFT JOIN public.clients c ON c.id = t.client_id
      LEFT JOIN public.sales_orders so ON so.id = t.sales_order_id`,
    docNo: sql`t.code`,
    date: sql`t.invoice_date::date`,
    party: sql`COALESCE(c.name, t.client_name_text)`,
    text: [sql`t.remarks`],
    refs: [soRef(sql`COALESCE(t.so_code_text, so.code)`)],
    lines: {
      from: sql`public.invoice_lines l`,
      fk: sql`l.invoice_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name`),
      match: [sql`l.item_code_text`, sql`l.item_name`],
      order: sql`l.line_no`,
      qty: sql`l.qty`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'plan',
    from: sql`public.plans t
      LEFT JOIN public.job_cards jc ON jc.id = t.jc_id
      LEFT JOIN public.bom_masters bm ON bm.id = t.bom_master_id`,
    docNo: sql`t.code`,
    date: sql`t.plan_date::date`,
    party: null,
    text: [sql`t.remarks`, sql`t.plan_type::text`],
    shown: [sql`t.item_code_text`, sql`t.item_name_text`],
    refs: [soRef(sql`t.so_code_text`), ref('JC', sql`jc.code`), ref('BOM', sql`bm.bom_no`)],
    flatLines: [pair(sql`t.item_code_text`, sql`t.item_name_text`)],
    lines: opLines(sql`public.plan_ops l`, sql`l.plan_id`, [sql`l.outsource_vendor_text`]),
    qty: sql`t.plan_qty`,
    status: sql`t.plan_status::text`,
  },
  {
    kind: 'bom-master',
    from: sql`public.bom_masters t LEFT JOIN public.items pi ON pi.id = t.parent_item_id`,
    docNo: sql`t.bom_no`,
    date: sql`COALESCE(t.revision_date::date, t.created_at::date)`,
    party: null,
    text: [sql`t.bom_name`],
    shown: [sql`pi.code`, sql`pi.name`],
    flatLines: [pair(sql`pi.code`, sql`pi.name`)],
    lines: {
      from: sql`public.bom_master_lines l LEFT JOIN public.items li ON li.id = l.child_item_id`,
      fk: sql`l.bom_master_id`,
      display: pair(sql`li.code`, sql`li.name`),
      match: [sql`li.code`, sql`li.name`],
      order: sql`l.line_no`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'route-card',
    from: sql`public.route_cards t LEFT JOIN public.items i ON i.id = t.item_id`,
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    party: null,
    text: [sql`t.notes`],
    shown: [sql`i.code`, sql`i.name`],
    flatLines: [pair(sql`i.code`, sql`i.name`)],
    lines: opLines(sql`public.route_card_ops l`, sql`l.route_card_id`, [
      sql`l.osp_vendor_code_text`,
    ]),
    qty: null,
    status: null,
  },
  {
    kind: 'design-project',
    from: sql`public.design_projects t
      LEFT JOIN public.clients c ON c.id = t.client_id
      LEFT JOIN public.sales_orders so ON so.id = t.sales_order_id`,
    docNo: sql`t.code`,
    date: sql`t.start_date::date`,
    party: sql`COALESCE(c.name, t.client_text)`,
    text: [sql`t.description`, sql`t.lead_text`],
    shown: [sql`t.project_name`],
    refs: [soRef(sql`COALESCE(t.so_code_text, so.code)`)],
    flatLines: [sql`NULLIF(t.project_name, '')`],
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'jw-dc-outward',
    from: sql`public.jw_dc_outward t
      LEFT JOIN public.vendors v ON v.id = t.vendor_id
      LEFT JOIN public.purchase_orders po ON po.id = t.purchase_order_id`,
    docNo: sql`t.code`,
    date: sql`t.dc_date::date`,
    party: sql`COALESCE(v.name, t.vendor_name_text, t.vendor_code_text)`,
    text: [sql`t.vehicle_no`, sql`t.remarks`],
    refs: [ref('JWPO', sql`COALESCE(t.jwpo_code_text, po.code)`)],
    lines: {
      from: sql`public.jw_dc_outward_lines l`,
      fk: sql`l.jw_dc_outward_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name_text`),
      match: [sql`l.item_code_text`, sql`l.item_name_text`, sql`l.process_text`],
      order: sql`l.line_no`,
      qty: sql`l.sent_qty`,
    },
    qty: null,
    status: null,
  },
];
