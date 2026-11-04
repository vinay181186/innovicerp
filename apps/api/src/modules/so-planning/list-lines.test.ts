// ADR-267 — GET /so-planning/lines: one row per live line of an open SO / JWSO,
// every figure equal to the same line on the order detail. Fixture: list-lines.fixture.ts.
//
// NOTE: like every api integration test this writes to the database DATABASE_URL
// points at — never run it against production (house rules).

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanningLineListItem } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { listPlanningLines } from './list-lines';
import {
  CLOSED_CODE,
  cleanupPlanningLinesFixture,
  EQ_CODE,
  JW_CODE,
  P,
  POL_LINE_3,
  setupPlanningLinesFixture,
  SO_CODE,
} from './list-lines.fixture';
import { soPlanningRoutes } from './routes';
import * as service from './service';

let admin: AuthContext;
let app: FastifyInstance;
let jwId: string;
let soId: string;
let eqId: string;
let proCode: string;

beforeAll(async () => {
  ({ admin, jwId, soId, eqId, proCode } = await setupPlanningLinesFixture());

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.addHook('preHandler', async (req) => {
    req.user = admin;
  });
  await app.register(soPlanningRoutes);
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await cleanupPlanningLinesFixture();
});

const rowsOf = async (search: string): Promise<PlanningLineListItem[]> =>
  (await listPlanningLines(admin, { search })).items;

const planStateSf = (...values: string[]): string =>
  JSON.stringify({ sort: null, filters: [{ field: 'planState', kind: 'values', values }] });

describe('one row per line', () => {
  it('a 4-line JWSO gives 4 rows in Ln order; the cancelled line is absent', async () => {
    const rows = await rowsOf(JW_CODE);
    expect(rows.map((r) => r.lineNo)).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => r.source === 'jw' && r.soType === 'job_work')).toBe(true);
    expect(rows.every((r) => r.soInternalNo === null)).toBe(true);
  });

  it("a closed order's lines are absent", async () => {
    expect(await rowsOf(CLOSED_CODE)).toHaveLength(0);
  });

  it('SO rows come before JW rows, and src narrows to one source', async () => {
    const all = (await listPlanningLines(admin, { search: P })).items;
    const firstJw = all.findIndex((r) => r.source === 'jw');
    expect(firstJw).toBeGreaterThan(0);
    expect(all.slice(firstJw).every((r) => r.source === 'jw')).toBe(true);
    const onlyJw = (await listPlanningLines(admin, { search: P, src: 'jw' })).items;
    expect(onlyJw.every((r) => r.source === 'jw')).toBe(true);
    expect(onlyJw.length).toBe(all.length - firstJw);
  });

  it('a plan with 2 Production Orders yields one row carrying both', async () => {
    const rows = (await rowsOf(SO_CODE)).filter((r) => r.lineNo === 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.plans).toHaveLength(1);
    expect(rows[0]!.plans[0]!.productionOrders).toHaveLength(2);
  });
});

describe('every figure on a list row equals the same line on the order detail', () => {
  const SHARED_FIELDS = [
    'itemRevisionId',
    'drawingRev',
    'lineNo',
    'clientPoLineNo',
    'createdAt',
    'createdByName',
    'itemId',
    'itemCode',
    'itemRevision',
    'itemName',
    'orderQty',
    'dueDate',
    'itemProcurementType',
    'prQty',
    'prs',
    'plans',
    'totalPlanned',
    'directJcQty',
    'directJcCodes',
    'remaining',
    'shortClosed',
    'lineStatus',
  ] as const;

  it.each([
    ['JWSO', JW_CODE, () => jwId],
    ['SO', SO_CODE, () => soId],
    ['Equipment SO', EQ_CODE, () => eqId],
  ])('%s', async (_label, code, id) => {
    const rows = await rowsOf(code);
    const detail = await service.getPlanningSoDetail(id(), admin);
    expect(rows.length).toBe(detail.lines.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const line = detail.lines.find((l) => l.soLineId === row.soLineId)!;
      for (const f of SHARED_FIELDS) expect(row[f], f).toEqual(line[f]);
      expect(row.soCode).toBe(detail.soCode);
      expect(row.customerName).toBe(detail.customerName);
      expect(row.soType).toBe(detail.soType);
      expect(row.source).toBe(detail.source);
    }
  });

  it('Buy line: the live PR counts as planned', async () => {
    const line2 = (await rowsOf(SO_CODE)).find((r) => r.lineNo === 2)!;
    expect(line2.prQty).toBe(4);
    expect(line2.totalPlanned).toBe(4);
    expect(line2.remaining).toBe(6);
  });

  it('Equipment line counts complete sets (weakest part); the spare line its own plans', async () => {
    const rows = await rowsOf(EQ_CODE);
    expect(rows.find((r) => r.lineNo === 1)!.totalPlanned).toBe(4);
    expect(rows.find((r) => r.lineNo === 2)!.totalPlanned).toBe(3);
  });
});

describe('paging, search, Sort & Filter', () => {
  it('total counts every match; items holds the page asked for', async () => {
    const out = await listPlanningLines(admin, { search: JW_CODE, limit: 2, offset: 1 });
    expect(out.total).toBe(4);
    expect(out.items.map((r) => r.lineNo)).toEqual([2, 3]);
    const end = await listPlanningLines(admin, { search: JW_CODE, limit: 2, offset: 4 });
    expect(end.total).toBe(4);
    expect(end.items).toHaveLength(0);
  });

  it('search finds a PRO code and a POL on a line beyond page 1', async () => {
    const page1 = await listPlanningLines(admin, { search: SO_CODE, limit: 1 });
    expect(page1.items[0]!.lineNo).toBe(1);

    const byPro = await listPlanningLines(admin, { search: proCode, limit: 1 });
    expect(byPro.total).toBe(1);
    expect(byPro.items[0]!.soCode).toBe(SO_CODE);
    expect(byPro.items[0]!.lineNo).toBe(3);

    // Case-insensitive, spaces around the term ignored.
    const byPol = await listPlanningLines(admin, {
      search: `  ${POL_LINE_3.toLowerCase()} `,
      limit: 1,
    });
    expect(byPol.total).toBe(1);
    expect(byPol.items[0]!.lineNo).toBe(3);
  });

  it('search matches the typed part name, a plan code and a PR code', async () => {
    expect((await rowsOf('JW part 2')).map((r) => r.lineNo)).toEqual([2]);
    expect((await rowsOf(`${P}PL-JW2`)).map((r) => r.lineNo)).toEqual([2]);
    expect((await rowsOf(`${P}PR-1`)).map((r) => r.lineNo)).toEqual([2]);
  });

  it('filters on planState', async () => {
    const unplanned = await listPlanningLines(admin, {
      search: JW_CODE,
      sf: planStateSf('unplanned'),
    });
    expect(unplanned.items.map((r) => r.lineNo)).toEqual([1]);
    const partly = await listPlanningLines(admin, {
      search: JW_CODE,
      sf: planStateSf('partly_planned'),
    });
    expect(partly.items.map((r) => r.lineNo)).toEqual([2, 4]);
  });

  it('sorts on a field and refuses a field the list does not have', async () => {
    const sorted = await listPlanningLines(admin, {
      search: JW_CODE,
      sf: JSON.stringify({ sort: { field: 'lineNo', dir: 'desc' }, filters: [] }),
    });
    expect(sorted.items.map((r) => r.lineNo)).toEqual([4, 3, 2, 1]);
    await expect(
      listPlanningLines(admin, {
        sf: JSON.stringify({ sort: { field: 'noSuchField', dir: 'asc' }, filters: [] }),
      }),
    ).rejects.toThrow(/cannot be sorted or filtered/);
  });
});

describe('JWSO: list and order view agree (ADR-267)', () => {
  it('a short-closed line reads remaining 0, fully planned, on BOTH', async () => {
    const row = (await rowsOf(JW_CODE)).find((r) => r.lineNo === 3)!;
    expect(row.shortClosed).toBe(true);
    expect(row.remaining).toBe(0);
    expect(row.lineStatus).toBe('fully_planned');

    const line = (await service.getPlanningSoDetail(jwId, admin)).lines.find(
      (l) => l.lineNo === 3,
    )!;
    expect(line.shortClosed).toBe(true);
    expect(line.remaining).toBe(0);
    expect(line.balanceToPlan).toBe(0);
    expect(line.lineStatus).toBe('fully_planned');

    const filtered = await listPlanningLines(admin, {
      search: JW_CODE,
      sf: planStateSf('fully_planned'),
    });
    expect(filtered.items.map((r) => r.lineNo)).toEqual([3]);
  });

  it('a direct rework Job Card is not counted, on list or detail', async () => {
    const row = (await rowsOf(JW_CODE)).find((r) => r.lineNo === 4)!;
    const line = (await service.getPlanningSoDetail(jwId, admin)).lines.find(
      (l) => l.lineNo === 4,
    )!;
    for (const l of [row, line]) {
      expect(l.directJcQty).toBe(2);
      expect(l.directJcCodes).toEqual([`${P}JC-JW4-DIRECT`]);
      expect(l.remaining).toBe(8);
    }
  });
});

describe('GET /so-planning/lines', () => {
  it('200 — not captured as an order id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/so-planning/lines?search=${JW_CODE}&limit=25`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; generatedAt: string; items: unknown[] };
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(4);
    expect(typeof body.generatedAt).toBe('string');
    // The typed-text search fields stay on the server.
    expect(body.items[0]).not.toHaveProperty('partName');
  });

  it('400 on a bad page size', async () => {
    const res = await app.inject({ method: 'GET', url: '/so-planning/lines?limit=abc' });
    expect(res.statusCode).toBe(400);
  });

  it('401 when no user attached', async () => {
    const bare = Fastify();
    await bare.register(errorHandlerPlugin);
    await bare.register(soPlanningRoutes);
    const res = await bare.inject({ method: 'GET', url: '/so-planning/lines' });
    expect(res.statusCode).toBe(401);
    await bare.close();
  });
});
