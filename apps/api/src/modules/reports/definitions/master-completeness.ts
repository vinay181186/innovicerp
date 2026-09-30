// Master Completeness (plan v3 Phase E — the Phase F gate). For each master
// (Customer, Vendor, Item) and each key field GST / invoices need: how many
// records it applies to, how many are still blank, and the % complete. One
// "All key fields" row per master counts the records with EVERY key field
// filled. Master Rules Mode can go to 'enforce' when every row reads 100%.
//
// The same rules as packages/shared/src/lib/master-rules.ts and the
// "Data Fill - *.xlsx" yellow cells:
//   - GSTIN is needed unless the GST Category is Unregistered / Overseas;
//   - State (State Code) is needed unless Overseas;
//   - HSN Code is needed on items we sell (Component / Assembly);
//   - Material on Component / Assembly / Raw Material.
// Blank = NULL or only spaces. Soft-deleted records are left out.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { numCell, type SqlRow } from './report-helpers';

/** SQL: TRUE when the column is NULL or only blanks. */
const blank = (col: string): string => `coalesce(btrim(${col}), '') = ''`;

interface KeyField {
  label: string;
  /** Records this field applies to (SQL boolean; 'true' = every record). */
  appliesTo: string;
  /** SQL boolean: the field is missing. */
  missing: string;
}

const NEEDS_GSTIN = `coalesce(gst_category, '') NOT IN ('unregistered', 'overseas')`;
const NEEDS_STATE = `coalesce(gst_category, '') <> 'overseas'`;

const partyFields = (daysLabel: string, daysCol: string): KeyField[] => [
  { label: 'GST Category', appliesTo: 'true', missing: blank('gst_category') },
  { label: 'GSTIN', appliesTo: NEEDS_GSTIN, missing: blank('gst_number') },
  { label: 'State', appliesTo: NEEDS_STATE, missing: blank('state_code') },
  { label: 'City', appliesTo: 'true', missing: blank('city') },
  { label: 'Pincode', appliesTo: 'true', missing: blank('pincode') },
  { label: 'Contact Person', appliesTo: 'true', missing: blank('contact_person') },
  { label: 'Phone', appliesTo: 'true', missing: blank('phone') },
  { label: 'Email', appliesTo: 'true', missing: blank('email') },
  { label: daysLabel, appliesTo: 'true', missing: `${daysCol} IS NULL` },
];

const MASTERS: { master: string; table: string; fields: KeyField[] }[] = [
  { master: 'Customer', table: 'clients', fields: partyFields('Payment Days', 'payment_days') },
  {
    master: 'Vendor',
    table: 'vendors',
    fields: partyFields('Payment Terms (days)', 'payment_terms_days'),
  },
  {
    master: 'Item',
    table: 'items',
    fields: [
      {
        label: 'HSN Code (items we sell)',
        appliesTo: `item_type IN ('component', 'assembly')`,
        missing: blank('hsn_code'),
      },
      {
        label: 'Material',
        appliesTo: `item_type IN ('component', 'assembly', 'raw_material')`,
        missing: blank('material'),
      },
    ],
  },
];

const pct = (records: number, missing: number): number =>
  records === 0 ? 100 : Math.round(((records - missing) / records) * 1000) / 10;

export const masterCompletenessReport: RegisteredReport = {
  definition: {
    slug: 'master-completeness',
    title: 'Master Completeness',
    description:
      'For Customers, Vendors and Items: how many records still have a blank GST Category, GSTIN, State, City, Pincode, Contact Person, Phone, Email, Payment Days / Terms, HSN Code (items we sell) or Material — and the % complete. Every row at 100% = ready to switch Master Rules Mode to Enforce.',
    group: 'Masters',
    filters: [],
    columns: [
      { key: 'master', label: 'Master', type: 'text' },
      { key: 'key_field', label: 'Key Field', type: 'text' },
      { key: 'records', label: 'Records Checked', type: 'number' },
      { key: 'blank', label: 'Blank', type: 'number' },
      { key: 'pct_complete', label: '% Complete', type: 'number' },
    ],
  },
  async run({ tx, companyId }) {
    const rows: Record<string, string | number>[] = [];
    for (const m of MASTERS) {
      // Column list and table name are fixed strings from MASTERS above —
      // never user input — so sql.raw is safe here.
      const selects = [
        `count(*)::int AS total`,
        `count(*) FILTER (WHERE ${m.fields.map((f) => `((${f.appliesTo}) AND ${f.missing})`).join(' OR ')})::int AS incomplete`,
        ...m.fields.flatMap((f, i) => [
          `count(*) FILTER (WHERE ${f.appliesTo})::int AS n${i}`,
          `count(*) FILTER (WHERE (${f.appliesTo}) AND ${f.missing})::int AS b${i}`,
        ]),
      ].join(',\n');
      const result = await tx.execute(sql`
        SELECT ${sql.raw(selects)}
        FROM ${sql.raw(`public.${m.table}`)}
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
      `);
      const r = (result as unknown as SqlRow[])[0] ?? {};
      m.fields.forEach((f, i) => {
        const records = numCell(r[`n${i}`]);
        const missing = numCell(r[`b${i}`]);
        rows.push({
          master: m.master,
          key_field: f.label,
          records,
          blank: missing,
          pct_complete: pct(records, missing),
        });
      });
      const total = numCell(r['total']);
      const incomplete = numCell(r['incomplete']);
      rows.push({
        master: m.master,
        key_field: 'All key fields (whole record)',
        records: total,
        blank: incomplete,
        pct_complete: pct(total, incomplete),
      });
    }
    return { columns: masterCompletenessReport.definition.columns, rows };
  },
};
