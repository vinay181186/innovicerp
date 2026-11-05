// The document types behind loadRelatedItems (lib/related-items): one entry per
// type, saying where its lines live and how its Rev and POL are reached. The rules
// themselves are stated at the top of related-items.ts.

export const blank = (col: string): string => `NULLIF(btrim(${col}::text), '')`;
const sameItem = (line: string, item: string): string =>
  `CASE WHEN ${line}.item_id = ${item} THEN ${blank(`${line}.revision`)} END`;
const ownRev = (col: string): string =>
  `(SELECT ir.rev FROM public.item_revisions ir WHERE ir.id = ${col})`;
/** Rev from the order line (aliases sol, jwl), only when it is for the same item
 *  as `itemCol`. The PO list's search reads it too. */
export const orderLineRev = (itemCol: string): string =>
  `COALESCE(${sameItem('sol', itemCol)}, ${sameItem('jwl', itemCol)})`;
const ORDER_LINE_REV = orderLineRev('l.item_id');
/** For kinds that reach a Job Card (alias ljc): the card's own Rev comes first, when
 *  the card is for the same item, so a JC on Rev 1 whose SO line moved to Rev 2 still
 *  prints /1 on its NC, PR, PO, DC and GRN rows. Then the order line's. */
export const jobCardRev = (itemCol: string): string =>
  `COALESCE(CASE WHEN ljc.item_id = ${itemCol} THEN ${ownRev('ljc.item_revision_id')} END, ${orderLineRev(itemCol)})`;
const JOB_CARD_REV = jobCardRev('l.item_id');

/** SO / JWSO lines reached through a PO line (pol): directly, or via the JC op. */
export const ORDER_LINES_VIA_PO = `
  LEFT JOIN public.jc_ops ljo ON ljo.id = pol.source_jc_op_id AND ljo.deleted_at IS NULL
  LEFT JOIN public.job_cards ljc ON ljc.id = ljo.job_card_id AND ljc.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = COALESCE(pol.source_so_line_id, ljc.source_so_line_id) AND sol.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines jwl
    ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL`;

export interface Kind {
  /** Table with alias `l`. */
  from: string;
  /** Column of `l` holding the document's id. */
  doc: string;
  /** The item column; default l.item_id. */
  item?: string;
  /** Saved code / name; null = the table saves none. */
  codeText: string | null;
  nameText: string | null;
  /** Extra joins; must define aliases `sol` and `jwl` when `pol` is true. */
  joins?: string;
  /** Has `sol` + `jwl` for POL. */
  pol?: boolean;
  rev: string | null;
  order: string;
}

export const KINDS = {
  so: {
    from: 'public.sales_order_lines l',
    doc: 'sales_order_id',
    codeText: 'l.item_code_text',
    nameText: 'l.part_name',
    joins: `
      LEFT JOIN public.sales_order_lines sol ON sol.id = l.id
      LEFT JOIN public.job_work_order_lines jwl ON false`,
    pol: true,
    rev: blank('l.revision'),
    order: 'l.line_no',
  },
  jwo: {
    from: 'public.job_work_order_lines l',
    doc: 'job_work_order_id',
    codeText: 'l.item_code_text',
    nameText: 'l.part_name',
    joins: `
      LEFT JOIN public.sales_order_lines sol ON false
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = l.id`,
    pol: true,
    rev: blank('l.revision'),
    order: 'l.line_no',
  },
  plan: {
    from: 'public.plans l',
    doc: 'id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      LEFT JOIN public.sales_order_lines sol ON sol.id = l.so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = l.jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: `COALESCE(${ownRev('l.item_revision_id')}, ${ORDER_LINE_REV})`,
    order: 'l.code',
  },
  jobCard: {
    from: 'public.job_cards l',
    doc: 'id',
    codeText: null,
    nameText: null,
    joins: `
      LEFT JOIN public.sales_order_lines sol ON sol.id = l.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = l.source_jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: `COALESCE(${ownRev('l.item_revision_id')}, ${ORDER_LINE_REV})`,
    order: 'l.code',
  },
  productionOrder: {
    from: 'public.production_orders l',
    doc: 'id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      LEFT JOIN public.plans pl ON pl.id = l.plan_id AND pl.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol ON sol.id = pl.so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = pl.jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: `COALESCE(${ownRev('l.item_revision_id')}, ${ORDER_LINE_REV})`,
    order: 'l.code',
  },
  routeCard: {
    from: 'public.route_cards l',
    doc: 'id',
    codeText: null,
    nameText: null,
    rev: ownRev('l.item_revision_id'),
    order: 'l.code',
  },
  purchaseRequest: {
    from: 'public.purchase_requests l',
    doc: 'id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name',
    joins: `
      LEFT JOIN public.jc_ops ljo ON ljo.id = l.source_jc_op_id AND ljo.deleted_at IS NULL
      LEFT JOIN public.job_cards ljc ON ljc.id = ljo.job_card_id AND ljc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = COALESCE(l.source_so_line_id, ljc.source_so_line_id) AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.code',
  },
  purchaseOrder: {
    from: 'public.purchase_order_lines l',
    doc: 'purchase_order_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name',
    joins: `
      LEFT JOIN public.purchase_order_lines pol ON pol.id = l.id
      ${ORDER_LINES_VIA_PO}`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.line_no',
  },
  grn: {
    from: 'public.goods_receipt_note_lines l',
    doc: 'goods_receipt_note_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name',
    joins: `
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = l.purchase_order_line_id AND pol.deleted_at IS NULL
      ${ORDER_LINES_VIA_PO}`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.line_no',
  },
  deliveryChallan: {
    from: 'public.delivery_challan_lines l',
    doc: 'delivery_challan_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      JOIN public.delivery_challans dc ON dc.id = l.delivery_challan_id
      LEFT JOIN public.nc_register nc ON nc.id = COALESCE(l.nc_id, dc.nc_id) AND nc.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = l.purchase_order_line_id AND pol.deleted_at IS NULL
      LEFT JOIN public.jc_ops ljo ON ljo.id = pol.source_jc_op_id AND ljo.deleted_at IS NULL
      LEFT JOIN public.job_cards ljc
        ON ljc.id = COALESCE(ljo.job_card_id, nc.job_card_id, dc.job_card_id) AND ljc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = COALESCE(pol.source_so_line_id, dc.sales_order_line_id, ljc.source_so_line_id)
       AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.line_no',
  },
  jwDcOutward: {
    from: 'public.jw_dc_outward_lines l',
    doc: 'jw_dc_outward_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = l.purchase_order_line_id AND pol.deleted_at IS NULL
      ${ORDER_LINES_VIA_PO}`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.line_no',
  },
  jwDcInward: {
    from: 'public.jw_dc_inward_lines l',
    doc: 'jw_dc_inward_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      LEFT JOIN public.jw_dc_outward_lines jdol ON jdol.id = l.jw_dc_outward_line_id
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = jdol.purchase_order_line_id AND pol.deleted_at IS NULL
      ${ORDER_LINES_VIA_PO}`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.id',
  },
  invoice: {
    from: 'public.invoice_lines l',
    doc: 'invoice_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name',
    joins: `
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = l.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON false`,
    pol: true,
    rev: sameItem('sol', 'l.item_id'),
    order: 'l.line_no',
  },
  customerDispatch: {
    from: 'public.customer_dispatch_lines l',
    doc: 'customer_dispatch_id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name',
    joins: `
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = l.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON false`,
    pol: true,
    rev: `COALESCE(${ownRev('l.item_revision_id')}, ${sameItem('sol', 'l.item_id')})`,
    order: 'l.line_no',
  },
  /** An NC on a GRN line has no Job Card: its order line comes through the PO line. */
  nc: {
    from: 'public.nc_register l',
    doc: 'id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      LEFT JOIN public.job_cards ljc ON ljc.id = l.job_card_id AND ljc.deleted_at IS NULL
      LEFT JOIN public.goods_receipt_note_lines gl ON gl.id = l.grn_line_id AND gl.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = gl.purchase_order_line_id AND pol.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = COALESCE(ljc.source_so_line_id, pol.source_so_line_id) AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: JOB_CARD_REV,
    order: 'l.code',
  },
  /** The customer's raw material actually received. No Rev: the JWSO line's Rev
   *  is the finished part's drawing, not this material's. */
  partyGrn: {
    from: 'public.party_grn_lines l',
    doc: 'party_grn_id',
    item: 'pm.item_id',
    codeText: 'l.party_material_code_text',
    nameText: 'l.party_material_name',
    joins: `
      LEFT JOIN public.party_materials pm ON pm.id = l.party_material_id
      LEFT JOIN public.sales_order_lines sol ON false
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = l.jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: null,
    order: 'l.line_no',
  },
  bom: {
    from: 'public.bom_masters l',
    doc: 'id',
    item: 'l.parent_item_id',
    codeText: null,
    nameText: 'l.bom_name',
    rev: null,
    order: 'l.id',
  },
  /** A unit has no item column: its BOM's parent, else the saved part no. */
  assemblyUnit: {
    from: 'public.assembly_units l',
    doc: 'id',
    item: 'bm.parent_item_id',
    codeText: 'l.part_no_text',
    nameText: null,
    joins: `LEFT JOIN public.bom_masters bm ON bm.id = l.bom_master_id`,
    rev: null,
    order: 'l.id',
  },
} satisfies Record<string, Kind>;

export type RelatedItemKind = keyof typeof KINDS;

export type RelatedItemKind = keyof typeof KINDS;

/** Every kind, so a test can cover a new one without being told about it. */
export const RELATED_ITEM_KINDS = Object.keys(KINDS) as RelatedItemKind[];
