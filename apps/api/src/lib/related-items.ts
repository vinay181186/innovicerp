// The ONE lookup for "which item does this related document concern" (owner
// 2026-11-05). Each document type is one entry in lib/related-item-kinds; every Related Documents
// builder reads through loadRelatedItems, so code, name, Rev and POL follow the
// same rules on every page:
//
//   Item Code  live master code, else the saved text (SO, PO and GRN lines often
//              save no text, so the text can never be the first choice)
//   Item Name  master name, else the saved copy
//   Rev        the document's own Drawing Rev, else the Job Card's, else the SO /
//              JWSO line's, and an indirect Rev only when that card or line is for
//              the SAME item (a raw-material PO line does not inherit the part's
//              Rev). Never items.revision.
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
import { blank, KINDS, type Kind, type RelatedItemKind } from './related-item-kinds';

export type { RelatedItemKind } from './related-item-kinds';

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
  /** Soft-deleted fallback only: this row carries its document's latest deleted_at. */
  latest_removal?: boolean;
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
      ${includeDeleted ? sql`, l.deleted_at = MAX(l.deleted_at) OVER (PARTITION BY ${docCol}) AS latest_removal` : sql``}
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
  // A cancelled document's lines are soft-deleted with it, in one transaction, so
  // they share its latest deleted_at. It still names those items; lines an edit
  // removed earlier carry an older stamp and stay out. A live document with every
  // line removed shows its last-removed lines: rare and acceptable.
  const found = new Set(rows.map((r) => r.doc_id));
  const cancelled = ids.filter((i) => !found.has(i));
  if (cancelled.length > 0) {
    const removed = await query(tx, kind, cancelled, null, true);
    rows = rows.concat(removed.filter((r) => r.latest_removal));
  }

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
