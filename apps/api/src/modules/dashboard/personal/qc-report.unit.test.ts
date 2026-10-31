// ADR-252 — "Reports to upload" home list + its notification, without a
// database. Run via `pnpm --filter @innovic/api test:unit`.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { dash, ev, perms, raw, rowCtx } from './test-fixtures';

vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));
vi.mock('../../purchase-orders/service', () => ({ loadApprovalContext: vi.fn() }));
vi.mock('../../access-control/users-with-right', () => ({ listUsersWithRight: vi.fn() }));

const lists = await import('./lists');
const notes = await import('./notifications');

const uploader = dash({ forms: { qcdocs_upload: perms({ view: true, entry: true }) } });
const viewer = dash({ forms: { qcdocs_upload: perms({ view: true }) } });

describe('qc_report_missing', () => {
  it('shown only to a QC Documents entry holder', () => {
    expect(lists.visibleListDefs(uploader).map((d) => d.key)).toContain('qc_report_missing');
    expect(lists.visibleListDefs(viewer).map((d) => d.key)).not.toContain('qc_report_missing');
  });

  it('query: report_required = true only (D8), no report, not reversed', () => {
    const q = new PgDialect().sqlToQuery(
      lists
        .listDef('qc_report_missing')!
        .query({ cid: 'c1', today: '2026-10-22', myName: 'J' }, {}),
    ).sql;
    expect(q).toMatch(/ol\.report_required = true AND ol\.qty > 0/);
    expect(q).toMatch(/ol\.reversal_of_id IS NULL/);
    expect(q).toMatch(/qd\.op_log_id = ol\.id/);
    expect(q).toMatch(/lower\(btrim\(qp\.code\)\) = lower\(btrim\(jo\.operation\)\)/);
  });

  it('row: JC number, report · POL · accepted · date, Upload report to the Dossier line', () => {
    const d = lists.listDef('qc_report_missing')!;
    const row = lists.toDashRow(
      d,
      raw({
        code: 'IN-JC-00012',
        kind: 'jwso',
        party: 'DIR',
        qty: 8,
        docDate: '2026-10-21',
        x1: 'order-1',
        x2: 'line-1',
        x3: '20',
      }),
      rowCtx(uploader),
    );
    expect(row.docHref).toBe(`/job-cards/${raw().id}`);
    expect(row.sub).toEqual([{ text: 'DIR · POL 20 · Accepted 8 · 21-Oct' }]);
    expect(row.actions).toEqual([
      {
        kind: 'create',
        label: 'Upload report',
        href: '/qc-docs?view=dossier&kind=jwso&orderId=order-1&lineId=line-1',
        taskFor: null,
      },
    ]);
  });

  it('notification: a QC entry by someone else notes BOTH next steps for a holder of both', () => {
    const both = dash({
      forms: {
        qcdocs_upload: perms({ view: true, entry: true }),
        op_entry: perms({ view: true, entry: true }),
      },
    });
    const got = notes.candidates(
      [
        ev({
          id: 'q1',
          entity: 'JobCard',
          action: 'QC',
          refId: 'IN-JC-1',
          qty: 4,
          opRef: 'Op 30 · DIR',
        }),
      ],
      notes.rulesFor(both),
      'me',
    );
    expect(got.map((g) => [g.key, g.rule.open])).toEqual([
      ['q1', 'ops_ready'],
      ['q1:qc_report_missing', 'qc_report_missing'],
    ]);
  });
});
