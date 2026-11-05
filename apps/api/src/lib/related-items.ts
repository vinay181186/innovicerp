// The ONE lookup for "which item does this related document concern" (owner
// 2026-11-05). Each document type is one entry below; every Related Documents
// builder reads through loadRelatedItems, so code, name, Rev and POL follow the
// same rules on every page:
//
//   Item Code  live master code, else the saved text (SO, PO and GRN lines often
//              save no text, so the text can never be the first choice)
//   Item Name  master name, else the saved copy
//   Rev        the document's own Drawing Rev, else the SO / JWSO line's, and an
//              indirect line's Rev only when that line is for the SAME item (a
//              raw-material PO line does not inherit the part's Rev). Never
//              items.revision.
//   POL        SO line, else JWSO line (lib/pol)
//
// A deleted item keeps its code and name but itemId is null, so no dead link.
//
// Read-only. Called inside the builder's withUserContext transaction, with ids the
// builder has already scoped to the company.

import type { RelatedItem } from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { polSql } from './pol';

const blank = (col: string): string => `NULLIF(btrim(${col}::text), '')`;
const sameItem = (line: string, item: string): string =>
  `CASE WHEN ${line}.item_id = ${item} THEN ${blank(`${line}.revision`)} END`;
const ownRev = (col: string): string =>
  `(SELECT ir.rev FROM public.item_revisions ir WHERE ir.id = ${col})`;
/** Rev from the order line, only when it is for the same item as this line. */
const ORDER_LINE_REV = `COALESCE(${sameItem('sol', 'l.item_id')}, ${sameItem('jwl', 'l.item_id')})`;

/** SO / JWSO lines reached through a PO line (pol): directly, or via the JC op. */
const ORDER_LINES_VIA_PO = `
  LEFT JOIN public.jc_ops ljo ON ljo.id = pol.source_jc_op_id AND ljo.deleted_at IS NULL
  LEFT JOIN public.job_cards ljc ON ljc.id = ljo.job_card_id AND ljc.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = COALESCE(pol.source_so_line_id, ljc.source_so_line_id) AND sol.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines jwl
    ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL`;

interface Kind {
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

const KINDS = {
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
    rev: ORDER_LINE_REV,
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
    rev: ORDER_LINE_REV,
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
    rev: ORDER_LINE_REV,
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
    rev: ORDER_LINE_REV,
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
    rev: ORDER_LINE_REV,
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
    rev: ORDER_LINE_REV,
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
  nc: {
    from: 'public.nc_register l',
    doc: 'id',
    codeText: 'l.item_code_text',
    nameText: 'l.item_name_text',
    joins: `
      LEFT JOIN public.job_cards ljc ON ljc.id = l.job_card_id AND ljc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = ljc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL`,
    pol: true,
    rev: ORDER_LINE_REV,
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

/** Narrow a document to the lines that actually link it to the anchor: a Plan's SO
 *  row names the Plan's SO line, not every line of the SO. */
export interface RelatedItemScope {
  column:
    | 'id'
    | 'source_so_line_id'
    | 'source_jw_line_id'
    | 'source_pr_id'
    | 'source_bom_master_id'
    | 'sales_order_line_id'
    | 'purchase_order_line_id'
    | 'jw_line_id'
    | 'nc_id';
  ids: readonly (string | null | undefined)[];
}

interface Row {
  doc_id: string;
  line_id: string | null;
  item_id: string | null;
  item_code: string | null;
  item_revision: string | null;
  item_name: string | null;
  pol: string | null;
}

const uuidList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );

async function query(
  tx: DbTransaction,
  kind: Kind,
  docIds: readonly string[],
  scope: { column: string; ids: readonly string[] } | null,
  includeDeleted = false,
): Promise<Row[]> {
  const docCol = sql.raw(`l.${kind.doc}`);
  const itemCol = sql.raw(kind.item ?? 'l.item_id');
  const scopeFrag = scope
    ? sql`AND ${sql.raw(`l.${scope.column}`)} IN (${uuidList(scope.ids)})`
    : sql``;
  return (await tx.execute(sql`
    SELECT ${docCol} AS doc_id, l.id AS line_id,
      CASE WHEN i.deleted_at IS NULL THEN i.id END AS item_id,
      ${sql.raw(blank(`COALESCE(i.code, ${kind.codeText ?? 'NULL::text'})`))} AS item_code,
      ${sql.raw(blank(`COALESCE(i.name, ${kind.nameText ?? 'NULL::text'})`))} AS item_name,
      ${sql.raw(kind.rev ?? 'NULL::text')} AS item_revision,
      ${kind.pol ? polSql('sol', 'jwl') : sql.raw('NULL::text')} AS pol
    FROM ${sql.raw(kind.from)}
    ${sql.raw(kind.joins ?? '')}
    LEFT JOIN public.items i ON i.id = ${itemCol}
    WHERE ${docCol} IN (${uuidList(docIds)})
      ${includeDeleted ? sql`` : sql`AND l.deleted_at IS NULL`}
      ${scopeFrag}
    ORDER BY ${sql.raw(kind.order)}, l.id
  `)) as unknown as Row[];
}

/** One item per line, in line order, with exact repeats (same item + Rev + POL on
 *  two lines) dropped: the row names items, it does not count lines. */
export function distinctItems(rows: readonly RelatedItem[]): RelatedItem[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.itemId ?? r.itemCode ?? ''}|${r.itemName ?? ''}|${r.itemRevision ?? ''}|${r.clientPoLineNo ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** docId → that document's items. With a scope, a document none of whose lines
 *  match falls back to all its lines, so a row is never blank just because its link
 *  runs through the header. */
export async function loadRelatedItems(
  tx: DbTransaction,
  kindName: RelatedItemKind,
  docIds: readonly (string | null | undefined)[],
  scope?: RelatedItemScope,
): Promise<Map<string, RelatedItem[]>> {
  const ids = Array.from(new Set(docIds.filter((v): v is string => Boolean(v))));
  const out = new Map<string, RelatedItem[]>();
  if (ids.length === 0) return out;

  const kind: Kind = KINDS[kindName];
  const scopeIds = scope
    ? Array.from(new Set(scope.ids.filter((v): v is string => Boolean(v))))
    : [];
  let rows: Row[] = [];
  if (scope && scopeIds.length > 0) {
    rows = await query(tx, kind, ids, { column: scope.column, ids: scopeIds });
    const matched = new Set(rows.map((r) => r.doc_id));
    const rest = ids.filter((i) => !matched.has(i));
    if (rest.length > 0) rows = rows.concat(await query(tx, kind, rest, null));
  } else {
    rows = await query(tx, kind, ids, null);
  }
  // A cancelled document's lines are soft-deleted with it. It still names its item.
  const found = new Set(rows.map((r) => r.doc_id));
  const cancelled = ids.filter((i) => !found.has(i));
  if (cancelled.length > 0) rows = rows.concat(await query(tx, kind, cancelled, null, true));

  for (const r of rows) {
    const list = out.get(r.doc_id) ?? [];
    list.push({
      lineId: r.line_id,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemRevision: r.item_revision,
      itemName: r.item_name,
      clientPoLineNo: r.pol,
    });
    out.set(r.doc_id, list);
  }
  for (const [k, v] of out) out.set(k, distinctItems(v));
  return out;
}
