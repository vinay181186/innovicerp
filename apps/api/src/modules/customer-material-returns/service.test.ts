// Customer Material Return (ADR-203, owner D3) — test plan skeleton.
//
// Deliberately todo-only: the api suite's global setup writes to the database
// .env.local points at (PRODUCTION), so the integration cases below are to be
// filled in against the TEST database only, with T203- prefixed fixtures in the
// shape party-material-issues/service.test.ts uses (client, JWSO line with a
// customer RM, Party GRN line QC'd with accepted + rejected, a Job Card).

import { describe, it } from 'vitest';

describe('customer-material-returns — create (good)', () => {
  it.todo('returns spare good pieces: posts return/out on the JWSO line and bumps returned_qty');
  it.todo('refuses more than the line register balance (accepted − net issued − good returned)');
  it.todo('refuses more than the material stock (ledger writer)');
  it.todo('two rows on the same line share one balance (second row sees the first)');
  it.todo('allows a return on a closed / short-closed line (no open-for-work check)');
  it.todo('refuses a line of another JWSO, and a line with no customer RM');
  it.todo('CONCURRENCY §20.3: two returns of the full balance at once — exactly one wins');
});

describe('customer-material-returns — create (rejected)', () => {
  it.todo('requires a Party GRN line, on the same JWSO line, with QC done');
  it.todo('raises party_grn_lines.rejected_returned_qty and posts nothing to the register');
  it.todo('refuses more than rejected − already returned (409 from the conditional UPDATE)');
  it.todo('CONCURRENCY §20.3: two returns of all held rejects at once — exactly one wins');
});

describe('customer-material-returns — cancel', () => {
  it.todo('needs party_create edit AND approve');
  it.todo('good line: reversal/in on the line + returned_qty lowered');
  it.todo('rejected line: rejected_returned_qty lowered');
  it.todo('CONCURRENCY §20.2: two cancels at once — one succeeds, the other gets 409');
});

describe('customer-material-returns — reads', () => {
  it.todo('list: 25 per page, search on return code / JWSO code / customer / vehicle no.');
  it.todo('returnable: good rows with balance > 0, rejected rows with held > 0');
});
