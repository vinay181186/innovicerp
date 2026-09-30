/* eslint-disable no-console -- CLI script: its console output IS the report (same as apply-sql / seed). */
// READ-ONLY data-quality baseline (finding S7 / plan Point 2): counts the
// master-data and copy problems the clean-up steps must drive to zero —
// duplicates, blank GSTIN / State / HSN / material / payment days, bad GSTIN
// format, documents linked to deleted or inactive masters, document copies that
// differ from the master, 'TBD' placeholders, OSP DC / GRN vendor code holding a
// PO number, PO tax type outside the allowed list, SOs without a customer link.
//
// Usage (DB_TARGET is REQUIRED, same guard as apply-sql — see db-target.ts):
//   DB_TARGET=TEST pnpm --filter @innovic/api db:quality --env-file <test.env> [--out <file.json>]
//   (or: DB_TARGET=TEST pnpm --filter @innovic/api exec dotenv -e <test.env> -- tsx src/db/data-quality.ts)
// Only DATABASE_URL is read from the env file. Writes a JSON file (default
// ./data-quality-<target>-<yyyy-mm-dd>.json) and prints a table. Exit code 0
// even when counts are non-zero — it is a measurement, not a gate.
//
// Safety: everything runs inside BEGIN READ ONLY and is rolled back. A check
// that fails (e.g. a column not on this database yet) is reported as an error
// row; the others still run (each check has its own savepoint).

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { resolveDbTarget } from './db-target';

const { target, args, url } = resolveDbTarget('data-quality', process.argv.slice(2), {
  allowEnvFile: true,
});
const outIdx = args.indexOf('--out');
const outFile = resolve(
  outIdx >= 0 && args[outIdx + 1]
    ? args[outIdx + 1]!
    : `data-quality-${target}-${new Date().toISOString().slice(0, 10)}.json`,
);

// PO tax_type values the app understands (packages/shared SERVICE_PO_TAX_TYPES,
// web PO form None / sgst_cgst / igst). NULL = "None" and is allowed.
const PO_TAX_TYPES = ['sgst_cgst', 'igst'];
const GSTIN_RE = String.raw`^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`;
const NORM_NAME = String.raw`lower(regexp_replace(trim(name),'\s+',' ','g'))`;
const TBD = String.raw`~* '\m(tbd|to be decided|dummy)\M'`;

interface Check {
  id: string;
  label: string;
  sql: string;
}

const dupCode = (t: string) =>
  `SELECT count(*)::int AS groups, coalesce(sum(n),0)::int AS rows FROM (SELECT count(*) n FROM ${t} WHERE deleted_at IS NULL GROUP BY company_id, lower(trim(code)) HAVING count(*) > 1) x`;
const dupName = (t: string) =>
  `SELECT count(*)::int AS groups, coalesce(sum(n),0)::int AS rows FROM (SELECT count(*) n FROM ${t} WHERE deleted_at IS NULL GROUP BY company_id, ${NORM_NAME} HAVING count(*) > 1) x`;
const dupGst = (t: string) =>
  `SELECT count(*)::int AS groups, coalesce(sum(n),0)::int AS rows FROM (SELECT count(*) n FROM ${t} WHERE deleted_at IS NULL AND nullif(trim(gst_number),'') IS NOT NULL GROUP BY company_id, upper(trim(gst_number)) HAVING count(*) > 1) x`;
const partyStats = (t: string) =>
  `SELECT count(*)::int AS live,
          count(*) FILTER (WHERE NOT is_active)::int AS inactive,
          count(*) FILTER (WHERE nullif(trim(gst_number),'') IS NULL)::int AS gstin_blank,
          count(*) FILTER (WHERE nullif(trim(gst_number),'') IS NOT NULL AND upper(trim(gst_number)) !~ '${GSTIN_RE}')::int AS gstin_bad_format,
          count(*) FILTER (WHERE nullif(trim(state),'') IS NULL)::int AS state_blank,
          count(*) FILTER (WHERE nullif(trim(city),'') IS NULL)::int AS city_blank,
          count(*) FILTER (WHERE nullif(trim(pincode),'') IS NULL)::int AS pincode_blank,
          count(*) FILTER (WHERE nullif(trim(contact_person),'') IS NULL)::int AS contact_blank,
          count(*) FILTER (WHERE name ${TBD} OR code ${TBD})::int AS tbd_placeholder
     FROM ${t} WHERE deleted_at IS NULL`;

// Documents that point at a master: [table, fk column, master, label].
const LINKS: [string, string, 'clients' | 'vendors' | 'items', string][] = [
  ['sales_orders', 'client_id', 'clients', 'SO → customer'],
  ['job_work_orders', 'client_id', 'clients', 'JWSO → customer'],
  ['invoices', 'client_id', 'clients', 'Tax Invoice → customer'],
  ['jw_invoices', 'client_id', 'clients', 'JW Invoice → customer'],
  ['purchase_requests', 'vendor_id', 'vendors', 'PR → vendor'],
  ['purchase_orders', 'vendor_id', 'vendors', 'PO → vendor'],
  ['goods_receipt_notes', 'vendor_id', 'vendors', 'GRN → vendor'],
  ['delivery_challans', 'vendor_id', 'vendors', 'OSP DC → vendor'],
  ['jw_dc_outward', 'vendor_id', 'vendors', 'JW DC → vendor'],
  ['sales_order_lines', 'item_id', 'items', 'SO line → item'],
  ['purchase_order_lines', 'item_id', 'items', 'PO line → item'],
  ['goods_receipt_note_lines', 'item_id', 'items', 'GRN line → item'],
  ['delivery_challan_lines', 'item_id', 'items', 'OSP DC line → item'],
  ['job_work_order_lines', 'item_id', 'items', 'JWSO line → item'],
];

const CHECKS: Check[] = [
  // ---- duplicates ----
  ...(['clients', 'vendors', 'items'] as const).flatMap((t) => [
    {
      id: `dup_code.${t}`,
      label: `${t}: duplicate code (case/space-insensitive)`,
      sql: dupCode(t),
    },
    { id: `dup_name.${t}`, label: `${t}: duplicate name (normalised)`, sql: dupName(t) },
  ]),
  { id: 'dup_gstin.clients', label: 'clients: duplicate GSTIN', sql: dupGst('clients') },
  { id: 'dup_gstin.vendors', label: 'vendors: duplicate GSTIN', sql: dupGst('vendors') },
  // ---- blanks / format ----
  {
    id: 'master.clients',
    label: 'clients: blanks + GSTIN format + TBD',
    sql: partyStats('clients'),
  },
  {
    id: 'master.vendors',
    label: 'vendors: blanks + GSTIN format + TBD',
    sql: partyStats('vendors'),
  },
  {
    id: 'master.clients.payment_days',
    label: 'clients: payment days blank',
    sql: `SELECT count(*) FILTER (WHERE payment_days IS NULL)::int AS payment_days_blank FROM clients WHERE deleted_at IS NULL`,
  },
  {
    id: 'master.items',
    label: 'items: HSN / material blanks + TBD',
    sql: `SELECT count(*)::int AS live,
                 count(*) FILTER (WHERE nullif(trim(hsn_code),'') IS NULL)::int AS hsn_blank,
                 count(*) FILTER (WHERE nullif(trim(hsn_code),'') IS NOT NULL AND trim(hsn_code) !~ '^[0-9]{4}([0-9]{2}){0,2}$')::int AS hsn_bad_format,
                 count(*) FILTER (WHERE nullif(trim(material),'') IS NULL)::int AS material_blank,
                 count(*) FILTER (WHERE name ${TBD} OR code ${TBD})::int AS tbd_placeholder
            FROM items WHERE deleted_at IS NULL`,
  },
  // ---- links to deleted / inactive masters ----
  ...LINKS.map(([t, fk, m, label]) => ({
    id: `link.${t}.${fk}`,
    label: `${label}: deleted / inactive master`,
    sql: `SELECT count(*)::int AS rows,
                 count(*) FILTER (WHERE m.deleted_at IS NOT NULL)::int AS to_deleted
                 ${m === 'items' ? '' : ', count(*) FILTER (WHERE m.deleted_at IS NULL AND NOT m.is_active)::int AS to_inactive'}
            FROM ${t} d JOIN ${m} m ON m.id = d.${fk}
           ${t.endsWith('_lines') ? '' : 'WHERE d.deleted_at IS NULL'}`,
  })),
  // ---- copies that differ from the master ----
  {
    id: 'copy.sales_orders.customer_name',
    label: 'SO customer name ≠ customer master',
    sql: `SELECT count(*) FILTER (WHERE s.customer_name IS DISTINCT FROM c.name)::int AS differs FROM sales_orders s JOIN clients c ON c.id = s.client_id WHERE s.deleted_at IS NULL`,
  },
  {
    id: 'copy.job_work_orders.customer_name',
    label: 'JWSO customer name ≠ customer master',
    sql: `SELECT count(*) FILTER (WHERE j.customer_name IS DISTINCT FROM c.name)::int AS differs FROM job_work_orders j JOIN clients c ON c.id = j.client_id WHERE j.deleted_at IS NULL`,
  },
  {
    id: 'copy.sales_order_lines.part_name',
    label: 'SO line part name ≠ item master',
    sql: `SELECT count(*) FILTER (WHERE l.part_name IS DISTINCT FROM i.name)::int AS differs, count(*) FILTER (WHERE l.uom IS DISTINCT FROM i.uom)::int AS uom_differs FROM sales_order_lines l JOIN items i ON i.id = l.item_id`,
  },
  {
    id: 'copy.purchase_order_lines.item_name',
    label: 'PO line item name ≠ item master',
    sql: `SELECT count(*) FILTER (WHERE l.item_name IS DISTINCT FROM i.name)::int AS differs FROM purchase_order_lines l JOIN items i ON i.id = l.item_id`,
  },
  {
    id: 'copy.purchase_orders.vendor_code_text',
    label: 'PO vendor code copy: blank / ≠ vendor master',
    sql: `SELECT count(*) FILTER (WHERE nullif(trim(p.vendor_code_text),'') IS NULL)::int AS blank, count(*) FILTER (WHERE nullif(trim(p.vendor_code_text),'') IS NOT NULL AND p.vendor_code_text <> v.code)::int AS differs FROM purchase_orders p JOIN vendors v ON v.id = p.vendor_id WHERE p.deleted_at IS NULL`,
  },
  {
    id: 'copy.invoices.client',
    label: 'Tax Invoice customer name / GSTIN copy ≠ master',
    sql: `SELECT count(*) FILTER (WHERE n.client_name_text IS DISTINCT FROM c.name)::int AS name_differs, count(*) FILTER (WHERE coalesce(n.client_gst_text,'') IS DISTINCT FROM coalesce(c.gst_number,''))::int AS gstin_differs FROM invoices n JOIN clients c ON c.id = n.client_id`,
  },
  {
    id: 'copy.jw_dc_outward.vendor',
    label: 'JW DC vendor name / code copy ≠ master',
    sql: `SELECT count(*) FILTER (WHERE o.vendor_name_text IS DISTINCT FROM v.name)::int AS name_differs, count(*) FILTER (WHERE o.vendor_code_text IS DISTINCT FROM v.code)::int AS code_differs FROM jw_dc_outward o JOIN vendors v ON v.id = o.vendor_id`,
  },
  // ---- OSP DC / GRN vendor code holding a PO number (finding A32) ----
  {
    id: 'osp.delivery_challans.vendor_code_is_po',
    label: 'OSP DC vendor code holds a PO number',
    sql: `SELECT count(*)::int AS rows,
                 count(*) FILTER (WHERE d.vendor_code_text = d.po_code_text OR EXISTS (SELECT 1 FROM purchase_orders p WHERE p.company_id = d.company_id AND p.code = d.vendor_code_text))::int AS vendor_code_is_po
            FROM delivery_challans d`,
  },
  {
    id: 'osp.goods_receipt_notes.vendor_code_is_po',
    label: 'GRN vendor code holds a PO number',
    sql: `SELECT count(*)::int AS rows,
                 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM purchase_orders p WHERE p.company_id = g.company_id AND p.code = g.vendor_code_text))::int AS vendor_code_is_po
            FROM goods_receipt_notes g WHERE g.deleted_at IS NULL`,
  },
  // ---- placeholders ----
  {
    id: 'tbd.purchase_requests',
    label: "PR 'TBD' placeholder / blank item name",
    sql: `SELECT count(*)::int AS rows,
                 count(*) FILTER (WHERE item_name ${TBD} OR item_code_text ${TBD} OR vendor_code_text ${TBD})::int AS tbd,
                 count(*) FILTER (WHERE nullif(trim(item_name),'') IS NULL)::int AS item_name_blank
            FROM purchase_requests WHERE deleted_at IS NULL`,
  },
  // ---- PO tax type ----
  {
    id: 'po.tax_type_outside_list',
    label: `PO tax type not NULL / ${PO_TAX_TYPES.join(' / ')}`,
    sql: `SELECT count(*) FILTER (WHERE tax_type IS NOT NULL AND tax_type NOT IN (${PO_TAX_TYPES.map((v) => `'${v}'`).join(',')}))::int AS outside_list,
                 coalesce(string_agg(DISTINCT tax_type, ',') FILTER (WHERE tax_type IS NOT NULL AND tax_type NOT IN (${PO_TAX_TYPES.map((v) => `'${v}'`).join(',')})), '') AS bad_values
            FROM purchase_orders WHERE deleted_at IS NULL`,
  },
  // ---- SO without customer link ----
  {
    id: 'so.no_client_id',
    label: 'SO without customer link (client_id)',
    sql: `SELECT count(*)::int AS rows, count(*) FILTER (WHERE client_id IS NULL)::int AS no_client_id,
                 count(*) FILTER (WHERE client_id IS NULL AND status NOT IN ('closed','cancelled'))::int AS no_client_id_not_closed
            FROM sales_orders WHERE deleted_at IS NULL`,
  },
];

interface Result {
  id: string;
  label: string;
  values?: Record<string, number | string>;
  error?: string;
}

const sql = postgres(url, { prepare: false, max: 1 });
const results: Result[] = [];
try {
  await sql.unsafe('BEGIN READ ONLY');
  for (const c of CHECKS) {
    await sql.unsafe('SAVEPOINT dq');
    try {
      const [row] = await sql.unsafe<Record<string, number | string>[]>(c.sql);
      results.push({ id: c.id, label: c.label, values: { ...row } });
      await sql.unsafe('RELEASE SAVEPOINT dq');
    } catch (e) {
      results.push({ id: c.id, label: c.label, error: (e as Error).message });
      await sql.unsafe('ROLLBACK TO SAVEPOINT dq');
    }
  }
} finally {
  await sql.unsafe('ROLLBACK').catch(() => undefined);
  await sql.end();
}

await writeFile(
  outFile,
  JSON.stringify({ target, generatedAt: new Date().toISOString(), checks: results }, null, 2) +
    '\n',
  'utf8',
);

const w = Math.max(...results.map((r) => r.label.length));
console.log(`\n[data-quality] ${target} — ${results.length} checks`);
for (const r of results) {
  const body = r.error
    ? `ERROR ${r.error}`
    : Object.entries(r.values ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join('  ');
  console.log(`  ${r.label.padEnd(w)}  ${body}`);
}
console.log(`[data-quality] JSON written to ${outFile}`);
