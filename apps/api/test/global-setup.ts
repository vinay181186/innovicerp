// Vitest globalSetup — wipes test-prefixed cruft from the dev DB before any
// test runs. Keeps the suite reliably runnable on the shared dev Supabase
// project (Phase 2 carry-over flagged a dedicated CI/staging DB as the
// proper fix; until then this is the workaround).
//
// Why this exists: tests use `T<phase>R?-` code prefixes (e.g. `T018-A1`,
// `T036C-LST`) and rely on `afterAll` hooks to delete by prefix. When a
// run is killed (Ctrl-C, OOM, network glitch), `afterAll` doesn't fire;
// rows accumulate and collide with the next run's `beforeAll` inserts.
//
// The wipe deletes parents first so FK CASCADE handles children:
//   - parent transactional rows (NC, DC, GRN, PO, PR, JC, SO, JW)
//   - then the masters they reference (items, vendors, clients, machines,
//     operators)
//   - store_transactions is wiped by source_ref pattern
//
// Pattern: `code LIKE 'T%-%'` matches every test prefix without false
// positives — real seed/migrated codes don't start with T0/T1/T2/T3/T4.

import postgres from 'postgres';

export default async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // Tests will fail in their own beforeAll; nothing useful to do here.
    return;
  }
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    // 1. Transactional tables with code LIKE 'T%-%'. Order matters: tables
    //    that other tables FK into must go AFTER their dependants.
    //    Lines tables cascade-delete from their headers, so we only target
    //    headers here.
    // T-prefixed NC codes from explicit test inserts + auto-NCs generated
    // from QC reject (T-040e) and outsource reject (T-059b) against T-prefixed
    // JC codes (format: NC-AUTO-<jcCode>-...). Both shapes wiped here so the
    // job_cards delete below doesn't trip the FK.
    await sql`DELETE FROM public.nc_register WHERE code LIKE 'T%-%' OR code LIKE 'NC-AUTO-T%'`;
    // delivery_challan_receipts CASCADE-deletes from delivery_challans, and
    // delivery_challan_receipt_lines CASCADE-delete from both their receipt
    // header AND from their dc_line — but we also wipe by receipt_code
    // pattern here as a belt-and-braces for any orphaned receipts.
    await sql`DELETE FROM public.delivery_challan_receipts WHERE receipt_code LIKE 'RCPT-T%-%'`;
    await sql`DELETE FROM public.delivery_challans WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.goods_receipt_notes WHERE code LIKE 'T%-%'`;
    // store_transactions has no `code` column; cruft surfaces via the
    // GRN-QC cascade with `source_ref` pointing at GRN codes that match.
    // Deleting goods_receipt_notes above should leave store_transactions
    // pointing at non-existent grn codes via source_ref text — clean those
    // by source_ref pattern + by remarks pattern (T036C tests write a
    // marker remark).
    await sql`DELETE FROM public.store_transactions WHERE source_ref LIKE 'T%-%' OR source_ref LIKE 'RCPT-T%-%' OR remarks LIKE '%T036%'`;
    // PL-4 ordering: plans MUST go before JCs/PRs they reference. The schema's
    // ON DELETE SET NULL on plans.jc_id / dp_pr_id / fo_pr_id would null those
    // out on JC/PR delete, then the CHECK `plans_status_fk_check` would trip
    // (jc_created requires jc_id NOT NULL, etc). Drop plans first.
    // plans CASCADE-delete their plan_ops via FK ON DELETE CASCADE.
    await sql`DELETE FROM public.plans WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.purchase_orders WHERE code LIKE 'T%-%'`;
    // PL-4 executePlan generates PR codes like PR-DP-<slug>-NN / PR-FO-... / PR-FOMAT-...
    // Sweep those by prefix in case a test crashed before afterAll could clean them.
    await sql`DELETE FROM public.purchase_requests WHERE code LIKE 'T%-%' OR code LIKE 'PR-DP-%' OR code LIKE 'PR-FO-%' OR code LIKE 'PR-FOMAT-%'`;
    await sql`DELETE FROM public.sales_orders WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.job_work_orders WHERE code LIKE 'T%-%'`;
    // job_cards CASCADE-deletes its jc_ops, op_log, running_ops (per
    // schema fk on_delete=cascade). Wiping here drops the whole subtree.
    // PL-4 executePlan generates codes JC-PLN-<slug>-NN — sweep those too
    // so a crashed test doesn't leave JCs referencing test items.
    await sql`DELETE FROM public.job_cards WHERE code LIKE 'T%-%' OR code LIKE 'JC-PLN-%'`;
    // route_cards CASCADE-delete their route_card_ops + route_card_revisions
    // (FK ON DELETE CASCADE). PL-4 tests create temporary route cards under
    // the test-prefix so cleanup wipes them too.
    await sql`DELETE FROM public.route_cards WHERE code LIKE 'T%-%'`;

    // 2. Master tables — referenced by transactional tables, so wipe last.
    //    These are also LIKE-matched at SELECT time by tests' notLike()
    //    guard, but the guard only protects against picking cruft as a
    //    fixture — it doesn't clean it up.
    await sql`DELETE FROM public.items WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.vendors WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.clients WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.machines WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.operators WHERE code LIKE 'T%-%'`;

    // 3. Saved reports — keyed by `name`, not `code`. Test inserts use a
    //    `T041B-` name prefix so we can clean by name LIKE without
    //    touching real user-created reports.
    await sql`DELETE FROM public.saved_reports WHERE name LIKE 'T041B-%'`;

    // 3a. op_log fixture rows hanging off seed JCs (T-040g qc-dashboard
    //     tests insert qc logs against IN-JC-00002 Op 1 with log_no
    //     `T040G-*`). Job-card-cascade doesn't reach these because the
    //     parent JC is real seed data, not test cruft.
    await sql`DELETE FROM public.op_log WHERE log_no LIKE 'T040G-%'`;

    // 4. Activity log — append-only audit trail. Test entries land via:
    //    (a) the T-051 service tests' explicit T051-prefixed entity, or
    //    (b) the items module emitter (T-009 follow-on) which writes
    //        activity rows referencing test items by ref_id = code.
    //    Wipe both so audit cruft doesn't pile up across runs.
    await sql`DELETE FROM public.activity_log WHERE entity LIKE 'T051-%' OR ref_id LIKE 'T%-%'`;

    // 5. Alert subscriptions + deliveries (T-041d Phase B). Subscription
    //    tests insert under the seed admin user_id using real registry
    //    codes (AL-001 etc.), so we wipe by user_id rather than by code
    //    pattern. Tests' own afterEach handles the steady-state cleanup;
    //    this catches killed-run cruft.
    await sql`DELETE FROM public.alert_subscriptions WHERE user_id IN (SELECT id FROM public.users WHERE email = 'innovic.technology@gmail.com')`;
    await sql`DELETE FROM public.alert_deliveries WHERE user_id IN (SELECT id FROM public.users WHERE email = 'innovic.technology@gmail.com')`;
  } finally {
    await sql.end();
  }
}
