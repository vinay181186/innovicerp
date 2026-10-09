// Vitest globalSetup — REFUSES to run against production, then wipes
// test-prefixed cruft before any test runs.
//
// THE GUARD IS THE POINT OF THIS FILE NOW. This suite deletes rows, and the
// only `.env.local` in the repo points at PRODUCTION — so `pnpm --filter api
// test` with the default environment pointed a DELETE at live data. That is why
// the suite has been unrunnable: nobody, human or agent, was allowed to invoke
// it, so §20's "ship a test that fires two requests at once" could not be
// honoured and six existing test files went unverified for months.
//
// The repo already had the answer and this file never used it: `db-target.ts`
// (finding S7) refuses a script whose DATABASE_URL is not the project it was
// told to expect, and `apply-sql`, `check-drift` and `data-quality` all call it.
// The fix was never a third database — it was this check, in the one place that
// skipped it.
//
// DELIBERATELY STRICTER than `resolveDbTarget`: that helper will proceed against
// PRODUCTION if a caller asks for it, which is correct for a migration and
// never correct for a test suite. Here production is refused unconditionally,
// whatever DB_TARGET says. An unrecognised remote host is refused too — a
// database we cannot identify is not a database we may delete from.
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
import { PROJECT_REFS } from '../src/db/db-target';

/** Refuse any database this suite must not delete from. Throws — vitest aborts
 *  the whole run and prints the reason, which is what we want: a test run that
 *  silently pointed somewhere else is worse than no test run. */
function assertSafeTestDatabase(url: string): void {
  const refuse = (why: string): never => {
    throw new Error(
      `[test] REFUSED TO RUN: ${why}
` +
        `  This suite DELETES rows (every code matching 'T%-%'), so it may only ever
` +
        `  touch the TEST project (${PROJECT_REFS.TEST}) or a database on this machine.
` +
        `  The repo's only .env.local points at PRODUCTION, so pass the test one explicitly:
` +
        `    pnpm --filter @innovic/api exec dotenv -e <test.env> -- vitest run
` +
        `  Build <test.env> from the TEST_* variables in erp/.env.local.`,
    );
  };

  if (url.includes(PROJECT_REFS.PROD)) {
    // Unconditional, and NOT overridable by DB_TARGET: there is no legitimate
    // reason for a suite that deletes rows to be aimed at live data.
    refuse('DATABASE_URL is the PRODUCTION project.');
  }
  if (url.includes(PROJECT_REFS.TEST)) return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    refuse('DATABASE_URL is not a valid URL.');
  }
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) return;
  refuse(`DATABASE_URL host "${host}" is neither the TEST project nor this machine.`);
}

export default async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // Refuse rather than return. Returning let the run continue and fail later
    // inside each test's own beforeAll, which read as a broken test rather than
    // a missing environment.
    throw new Error(
      '[test] REFUSED TO RUN: DATABASE_URL is not set. This suite will not guess which database to use.',
    );
  }
  assertSafeTestDatabase(url);
  // ADR-185 — named so the stock-ledger write-lock (0149) lets teardown through.
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connection: { application_name: 'innovic-test-harness' },
  });

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
    // Item-anchored belt-and-braces (see job_cards / purchase_requests below):
    // a GRN booked through the real receipt path gets a real code, so only its
    // LINES betray it as test data. Drop the whole header — lines CASCADE.
    await sql`
      DELETE FROM public.goods_receipt_notes
      WHERE id IN (
        SELECT DISTINCT goods_receipt_note_id FROM public.goods_receipt_note_lines
        WHERE item_id IN (SELECT id FROM public.items WHERE code LIKE 'T%-%'))`;
    // store_transactions has no `code` column; cruft surfaces via the
    // GRN-QC cascade with `source_ref` pointing at GRN codes that match.
    // Deleting goods_receipt_notes above should leave store_transactions
    // pointing at non-existent grn codes via source_ref text — clean those
    // by source_ref pattern + by remarks pattern (T036C tests write a
    // marker remark).
    // The stock ledger is append-only (ADR-185, trigger
    // store_transactions_refuse_change). It offers the harness two exits, and
    // the one this file used to rely on DOES NOT WORK against the TEST project:
    // the connection carries `application_name: 'innovic-test-harness'`, but
    // TEST goes through Supabase's pooler, which OVERWRITES application_name
    // with its own value ("Supavisor"). The trigger therefore never saw the
    // name, refused the DELETE with 23001, and the whole suite died in
    // globalSetup — the real reason these tests could not be run on TEST, on
    // top of the production guard above.
    //
    // Use the trigger's other exit instead, in the same transaction as the
    // DELETE: `set_config(..., true)` is transaction-local, so it survives a
    // transaction-mode pooler where a bare `SET` would not, and it cannot leak
    // the exemption to another session. Same device `withUserContext` uses for
    // the JWT claims.
    await sql.begin(async (tx) => {
      await tx`select set_config('innovic.ledger_maintenance', 'on', true)`;
      // Children first. `tool_writeoffs.store_transaction_id` is a plain FK with
      // no ON DELETE, so a write-off left behind by an aborted run pins its
      // ledger row and the DELETE below fails 23503. Scoped to exactly the rows
      // we are about to remove — never a blanket delete of the table.
      await tx`
        DELETE FROM public.tool_writeoffs
        WHERE store_transaction_id IN (
          SELECT id FROM public.store_transactions
          WHERE source_ref LIKE 'T%-%' OR source_ref LIKE 'RCPT-T%-%' OR remarks LIKE '%T036%')`;
      await tx`DELETE FROM public.store_transactions WHERE source_ref LIKE 'T%-%' OR source_ref LIKE 'RCPT-T%-%' OR remarks LIKE '%T036%'`;
    });
    // PL-4 ordering: plans MUST go before JCs/PRs they reference. The schema's
    // ON DELETE SET NULL on plans.jc_id / dp_pr_id / fo_pr_id would null those
    // out on JC/PR delete, then the CHECK `plans_status_fk_check` would trip
    // (jc_created requires jc_id NOT NULL, etc). Drop plans first.
    // plans CASCADE-delete their plan_ops via FK ON DELETE CASCADE.
    await sql`DELETE FROM public.plans WHERE code LIKE 'T%-%'`;
    // Item-anchored too. A plan created through the real path gets a real code
    // (PLN-0062) that no prefix matches, but its jc_id points at a test job
    // card. The item-anchored job_cards sweep below would then SET NULL that
    // jc_id and trip plans_status_fk_check (jc_created requires jc_id NOT NULL),
    // aborting the whole run at setup.
    await sql`
      DELETE FROM public.plans
      WHERE item_id IN (SELECT id FROM public.items WHERE code LIKE 'T%-%')
         OR jc_id IN (
           SELECT jc.id FROM public.job_cards jc
           JOIN public.items i ON i.id = jc.item_id
           WHERE i.code LIKE 'T%-%')`;
    await sql`DELETE FROM public.purchase_orders WHERE code LIKE 'T%-%'`;
    // PL-4 executePlan generates PR codes like PR-DP-<slug>-NN / PR-FO-... / PR-FOMAT-...
    // Sweep those by prefix in case a test crashed before afterAll could clean them.
    // BOM-8 cascadeBomToSoLine generates PR-BOM-<slug>-NN for purchase /
    // outsource components — no test prefix, so sweep by shape.
    await sql`DELETE FROM public.purchase_requests WHERE code LIKE 'T%-%' OR code LIKE 'PR-DP-%' OR code LIKE 'PR-FO-%' OR code LIKE 'PR-FOMAT-%' OR code LIKE 'PR-BOM-%'`;
    // Same item-anchored belt-and-braces as job_cards below: PRs raised through
    // the real creation path carry a real code no prefix pattern can match.
    await sql`
      DELETE FROM public.purchase_requests
      WHERE item_id IN (SELECT id FROM public.items WHERE code LIKE 'T%-%')`;
    await sql`DELETE FROM public.sales_orders WHERE code LIKE 'T%-%'`;
    await sql`DELETE FROM public.job_work_orders WHERE code LIKE 'T%-%'`;
    // job_cards CASCADE-deletes its jc_ops, op_log, running_ops (per
    // schema fk on_delete=cascade). Wiping here drops the whole subtree.
    // PL-4 executePlan generates codes JC-PLN-<slug>-NN — sweep those too
    // so a crashed test doesn't leave JCs referencing test items.
    // BOM-8 cascadeBomToSoLine generates JC-BOM-<slug>-NN for `manufacture`
    // components. Those carry no test prefix, so without this pattern they
    // survive the wipe and pin the test items below (FK job_cards.item_id),
    // failing the whole run at setup.
    await sql`DELETE FROM public.job_cards WHERE code LIKE 'T%-%' OR code LIKE 'JC-PLN-%' OR code LIKE 'JC-BOM-%'`;
    // Belt-and-braces: tests that go through the REAL job-card creation path
    // get a real sequential code (IN-JC-26-000NN), which no prefix pattern can
    // catch. Anchor on the item instead — a JC pointing at a test-prefixed item
    // is test cruft by construction, and leaving it pins the items wipe below.
    await sql`
      DELETE FROM public.job_cards
      WHERE item_id IN (SELECT id FROM public.items WHERE code LIKE 'T%-%')`;
    // route_cards CASCADE-delete their route_card_ops + route_card_revisions
    // (FK ON DELETE CASCADE). PL-4 tests create temporary route cards under
    // the test-prefix so cleanup wipes them too.
    await sql`DELETE FROM public.route_cards WHERE code LIKE 'T%-%'`;

    // BOM masters (bom_master_lines CASCADE from the header). Must run after
    // sales_orders above — sales_order_lines.source_bom_master_id FKs here.
    await sql`DELETE FROM public.bom_masters WHERE bom_no LIKE 'T%-%'`;

    // 1b. Item-anchored sweep — the general form of the JC/PR/GRN cases above.
    //     Anything created through a REAL creation path gets a real sequential
    //     code (IN-JW-00009, PLN-0062) that no prefix pattern can match, while
    //     its LINES still point at a test item. Those rows then pin the items
    //     wipe below via FK and abort the entire run at setup.
    //     Delete the HEADER so lines cascade; FK order matters, so this runs
    //     after the GRN / PO / PR passes above.
    const testItems = `SELECT id FROM public.items WHERE code LIKE 'T%-%'`;
    await sql.unsafe(`
      DELETE FROM public.delivery_challans WHERE id IN (
        SELECT DISTINCT delivery_challan_id FROM public.delivery_challan_lines
        WHERE item_id IN (${testItems}))`);
    await sql.unsafe(`
      DELETE FROM public.purchase_orders WHERE id IN (
        SELECT DISTINCT purchase_order_id FROM public.purchase_order_lines
        WHERE item_id IN (${testItems}))`);
    await sql.unsafe(`
      DELETE FROM public.sales_orders WHERE id IN (
        SELECT DISTINCT sales_order_id FROM public.sales_order_lines
        WHERE item_id IN (${testItems}))`);
    await sql.unsafe(`
      DELETE FROM public.job_work_orders WHERE id IN (
        SELECT DISTINCT job_work_order_id FROM public.job_work_order_lines
        WHERE item_id IN (${testItems}))`);
    // Direct item references — no header to cascade from.
    // party_material_issues FK into party_materials without cascade, so the
    // issues go first.
    await sql.unsafe(`
      DELETE FROM public.party_material_issues WHERE party_material_id IN (
        SELECT id FROM public.party_materials WHERE item_id IN (${testItems}))`);
    await sql.unsafe(`DELETE FROM public.party_materials WHERE item_id IN (${testItems})`);
    // The SECOND ledger delete, and it needs the same ADR-185 exemption as the
    // one above — flagged by the ADR-227 session. It survived the first run of
    // the fixed harness only because it matched ZERO rows: a BEFORE DELETE
    // trigger fires per row, so a DELETE that hits nothing never trips it. The
    // moment a test leaves a ledger row against a T-prefixed item, this line
    // throws 23001 inside globalSetup, vitest collects zero files, and every
    // later run reports "no tests" — which reads as nothing to run rather than
    // as the harness dying in setup. Exactly the shape the first one had.
    //
    // `tool_writeoffs` first for the same FK reason as above.
    await sql.begin(async (tx) => {
      await tx`select set_config('innovic.ledger_maintenance', 'on', true)`;
      await tx.unsafe(`
        DELETE FROM public.tool_writeoffs WHERE store_transaction_id IN (
          SELECT id FROM public.store_transactions WHERE item_id IN (${testItems}))`);
      await tx.unsafe(`DELETE FROM public.store_transactions WHERE item_id IN (${testItems})`);
    });
    await sql.unsafe(`DELETE FROM public.item_stock_balances WHERE item_id IN (${testItems})`);

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
