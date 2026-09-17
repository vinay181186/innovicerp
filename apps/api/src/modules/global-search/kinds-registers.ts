// Global Search registry, part 2: the masters (client / vendor / item) and
// the registers whose rows open on their host list filtered to the code.
// See kinds.ts for the shape. Column names verified against
// apps/api/src/db/schema.ts.

import { sql } from 'drizzle-orm';
import { type KindMeta, pair, ref, soRef } from './kinds';

const activeStatus = sql`CASE WHEN t.is_active THEN 'active' ELSE 'inactive' END`;
const partyContact = [
  sql`t.contact_person`,
  sql`t.email`,
  sql`t.phone`,
  sql`t.gst_number`,
  sql`t.city`,
];

export const REGISTER_KINDS: readonly KindMeta[] = [
  {
    kind: 'client',
    from: sql`public.clients t`,
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    party: null,
    text: partyContact,
    shown: [sql`t.name`],
    flatLines: [sql`NULLIF(t.name, '')`],
    qty: null,
    status: activeStatus,
  },
  {
    kind: 'vendor',
    from: sql`public.vendors t`,
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    party: null,
    text: partyContact,
    shown: [sql`t.name`],
    flatLines: [sql`NULLIF(t.name, '')`],
    qty: null,
    status: activeStatus,
  },
  {
    kind: 'item',
    from: sql`public.items t`,
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    party: null,
    text: [sql`t.description`, sql`t.material`, sql`t.hsn_code`],
    shown: [sql`t.name`, sql`t.drawing_no`],
    flatLines: [sql`NULLIF(t.name, '')`, sql`'Drg ' || NULLIF(t.drawing_no, '')`],
    qty: null,
    status: null,
  },
  {
    kind: 'customer-dispatch',
    from: sql`public.customer_dispatches t
      LEFT JOIN public.sales_orders so ON so.id = t.sales_order_id
      LEFT JOIN public.clients c ON c.id = so.client_id`,
    docNo: sql`t.code`,
    date: sql`t.dispatch_date::date`,
    party: sql`COALESCE(c.name, t.customer_text)`,
    text: [sql`t.transport`, sql`t.vehicle_no`, sql`t.remarks`],
    refs: [soRef(sql`COALESCE(t.so_code_text, so.code)`)],
    lines: {
      from: sql`public.customer_dispatch_lines l`,
      fk: sql`l.customer_dispatch_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name`),
      match: [sql`l.item_code_text`, sql`l.item_name`],
      order: sql`l.line_no`,
      qty: sql`l.qty`,
    },
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'jw-invoice',
    from: sql`public.jw_invoices t
      LEFT JOIN public.job_work_orders jw ON jw.id = t.job_work_order_id
      LEFT JOIN public.clients c ON c.id = COALESCE(t.client_id, jw.client_id)
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = t.job_work_order_line_id`,
    docNo: sql`t.code`,
    date: sql`t.invoice_date::date`,
    party: sql`COALESCE(c.name, jw.customer_name)`,
    text: [sql`t.remarks`],
    shown: [sql`jwl.item_code_text`, sql`jwl.part_name`],
    refs: [ref('JWSO', sql`COALESCE(t.jw_code_text, jw.code)`)],
    flatLines: [pair(sql`jwl.item_code_text`, sql`jwl.part_name`)],
    qty: sql`t.qty`,
    status: null,
  },
  {
    kind: 'jw-return',
    from: sql`public.jw_return_challans t
      LEFT JOIN public.job_work_orders jw ON jw.id = t.job_work_order_id
      LEFT JOIN public.clients c ON c.id = COALESCE(t.client_id, jw.client_id)
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = t.job_work_order_line_id
      LEFT JOIN public.job_cards jc ON jc.id = t.job_card_id`,
    docNo: sql`t.code`,
    date: sql`t.return_date::date`,
    party: sql`COALESCE(c.name, jw.customer_name)`,
    text: [sql`t.transport`, sql`t.vehicle_no`, sql`t.remarks`],
    shown: [sql`jwl.item_code_text`, sql`jwl.part_name`],
    refs: [ref('JWSO', sql`COALESCE(t.jw_code_text, jw.code)`), ref('JC', sql`jc.code`)],
    flatLines: [pair(sql`jwl.item_code_text`, sql`jwl.part_name`)],
    qty: sql`t.qty`,
    status: sql`t.status::text`,
  },
  {
    kind: 'capa',
    from: sql`public.capa_records t`,
    docNo: sql`t.code`,
    date: sql`t.capa_date::date`,
    party: null,
    text: [
      sql`t.root_cause`,
      sql`t.corrective_action`,
      sql`t.responsible`,
      sql`t.department`,
      sql`t.type`,
      sql`t.operation`,
    ],
    shown: [sql`t.nc_refs::text`, sql`t.problem`],
    // nc_refs is a jsonb array of NC codes — one "NC <code>" entry each.
    refsJson: sql`CASE WHEN jsonb_typeof(t.nc_refs) = 'array'
      THEN (SELECT jsonb_agg('NC ' || e) FROM jsonb_array_elements_text(t.nc_refs) e) END`,
    refs: [ref('JC', sql`t.jc_no`), soRef(sql`t.so_no`), ref('Item', sql`t.item_code`)],
    flatLines: [sql`NULLIF(t.problem, '')`],
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'store-issue',
    from: sql`public.store_issues t`,
    docNo: sql`t.code`,
    date: sql`t.issue_date::date`,
    party: sql`t.issued_to`,
    text: [sql`t.purpose`, sql`t.remarks`],
    shown: [sql`t.item_code_text`, sql`t.item_name`],
    refs: [ref(sql`NULLIF(t.ref_type, '')`, sql`t.ref_no`)],
    flatLines: [pair(sql`t.item_code_text`, sql`t.item_name`)],
    qty: sql`t.qty`,
    status: null,
  },
  {
    kind: 'tool-issue',
    from: sql`public.tool_issues t`,
    docNo: sql`t.code`,
    date: sql`t.issue_date::date`,
    party: sql`t.issued_to`,
    text: [sql`t.purpose`, sql`t.remarks`],
    shown: [sql`t.item_code_text`, sql`t.item_name`],
    refs: [ref(sql`NULLIF(t.ref_type, '')`, sql`t.ref_no`)],
    flatLines: [pair(sql`t.item_code_text`, sql`t.item_name`)],
    qty: sql`t.qty`,
    status: sql`t.return_status::text`,
  },
  {
    kind: 'party-grn',
    from: sql`public.party_grn t
      LEFT JOIN public.clients c ON c.id = t.client_id
      LEFT JOIN public.job_work_orders jw ON jw.id = t.job_work_order_id`,
    docNo: sql`t.code`,
    date: sql`t.grn_date::date`,
    party: sql`COALESCE(c.name, t.client_code_text)`,
    text: [sql`t.client_po_no`, sql`t.remarks`],
    refs: [ref('JWSO', sql`COALESCE(t.jw_code_text, jw.code)`), ref('Client DC', sql`t.dc_no`)],
    lines: {
      from: sql`public.party_grn_lines l`,
      fk: sql`l.party_grn_id`,
      display: pair(sql`l.party_material_code_text`, sql`l.party_material_name`),
      match: [
        sql`l.party_material_code_text`,
        sql`l.party_material_name`,
        sql`l.jw_line_no_text`,
        sql`l.remarks`,
      ],
      order: sql`l.line_no`,
      qty: sql`l.received_qty`,
    },
    qty: null,
    status: null,
  },
  {
    kind: 'party-material-issue',
    from: sql`public.party_material_issues t
      LEFT JOIN public.job_work_orders jw ON jw.id = t.job_work_order_id
      LEFT JOIN public.clients c ON c.id = jw.client_id
      LEFT JOIN public.job_cards jc ON jc.id = t.job_card_id`,
    docNo: sql`t.code`,
    date: sql`t.issue_date::date`,
    party: sql`COALESCE(c.name, jw.customer_name)`,
    text: [sql`t.remarks`],
    shown: [sql`t.party_material_code_text`, sql`t.party_material_name`],
    refs: [
      ref('JWSO', sql`COALESCE(t.jw_code_text, jw.code)`),
      ref('JC', sql`COALESCE(t.jc_code_text, jc.code)`),
    ],
    flatLines: [pair(sql`t.party_material_code_text`, sql`t.party_material_name`)],
    qty: sql`t.qty`,
    status: null,
  },
  {
    kind: 'jw-dc-inward',
    from: sql`public.jw_dc_inward t
      LEFT JOIN public.jw_dc_outward o ON o.id = t.jw_dc_outward_id
      LEFT JOIN public.vendors v ON v.id = o.vendor_id`,
    docNo: sql`t.code`,
    date: sql`t.inward_date::date`,
    party: sql`COALESCE(v.name, o.vendor_name_text)`,
    text: [sql`t.vehicle_no`, sql`t.remarks`],
    refs: [
      ref('JW DC', sql`COALESCE(t.dc_code_text, o.code)`),
      ref('Vendor DC', sql`t.vendor_challan_no`),
    ],
    lines: {
      from: sql`public.jw_dc_inward_lines l`,
      fk: sql`l.jw_dc_inward_id`,
      display: pair(sql`l.item_code_text`, sql`l.item_name_text`),
      match: [sql`l.item_code_text`, sql`l.item_name_text`, sql`l.process_text`, sql`l.remarks`],
      // jw_dc_inward_lines has no line_no column — entry order is the line order.
      order: sql`l.created_at`,
      qty: sql`l.received_qty`,
    },
    qty: null,
    status: null,
  },
  {
    kind: 'task',
    from: sql`public.tasks t LEFT JOIN public.users usr ON usr.id = t.assigned_to`,
    docNo: sql`t.code`,
    date: sql`t.due_date::date`,
    party: sql`usr.full_name`,
    text: [sql`t.description`, sql`t.priority::text`],
    shown: [sql`t.title`, sql`t.linked_ref_display`],
    refs: [ref(sql`NULLIF(t.linked_ref_type, '')`, sql`t.linked_ref_display`)],
    flatLines: [sql`NULLIF(t.title, '')`],
    qty: null,
    status: sql`t.status::text`,
  },
  {
    kind: 'design-tracker',
    from: sql`public.design_tracker t LEFT JOIN public.sales_orders so ON so.id = t.sales_order_id`,
    docNo: sql`t.code`,
    date: sql`t.start_date::date`,
    party: sql`t.designer`,
    text: [sql`t.remarks`],
    shown: [sql`t.item_code_text`, sql`t.item_name_text`],
    refs: [soRef(sql`COALESCE(t.so_code_text, so.code)`)],
    flatLines: [pair(sql`t.item_code_text`, sql`t.item_name_text`)],
    qty: null,
    status: sql`t.status::text`,
  },
];
