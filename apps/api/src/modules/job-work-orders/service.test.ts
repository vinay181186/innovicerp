import { and, asc, eq, isNull, like, ne, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentEditStagedResult } from '@innovic/shared';
import { db } from '../../db/client';
import {
  activityLog,
  approvalConfig,
  clients,
  documentEditRequests,
  items,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import { decideDocumentEdit } from '../document-edits/service';
import * as service from './service';

const TEST_PREFIX = 'T031-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstItemCode: string;
let firstClientId: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error('Seed admin missing — run pnpm --filter api seed');
  }
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  // Oldest non-test-prefixed item — sidesteps cross-test pollution where
  // op-entry's afterAll would delete a test item still referenced by a JW
  // line. Migrated seed items predate any test-created item.
  const itemRow = await db
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(
        eq(items.companyId, u.companyId),
        isNull(items.deletedAt),
        notLike(items.code, 'T%-%'),
        // ADR-203: a JWSO line's item may not be a customer material.
        ne(items.itemType, 'party_supplied_material'),
      ),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  const it = itemRow[0];
  if (!it) throw new Error('No items in seed company — run migration load first');
  firstItemId = it.id;
  firstItemCode = it.code;
  // ADR-203: every JWSO needs a client (its customer RM register is per client).
  const clientRow = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.companyId, u.companyId), isNull(clients.deletedAt)))
    .orderBy(asc(clients.createdAt))
    .limit(1);
  if (!clientRow[0]) throw new Error('No clients in seed company');
  firstClientId = clientRow[0].id;
});

afterAll(async () => {
  const testHeaders = await db
    .select({ id: jobWorkOrders.id })
    .from(jobWorkOrders)
    .where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, id));
    }
    await db.delete(jobWorkOrders).where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  }
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
});

describe('job-work-orders service', () => {
  it('createJobWorkOrder inserts header + lines with audit columns + numeric formatting', async () => {
    const code = `${TEST_PREFIX}A1`;
    const detail = await service.createJobWorkOrder(
      {
        header: {
          code,
          jwDate: '2026-05-02',
          clientId: firstClientId,
        },
        lines: [
          {
            partName: 'Machined Shaft',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 10,
            rate: 35.5,
          },
          {
            partName: 'Bracket',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 5,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(code);
    expect(detail.companyId).toBe(admin.companyId);
    expect(detail.createdBy).toBe(admin.id);
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]?.lineNo).toBe(1);
    expect(detail.lines[0]?.itemId).toBe(firstItemId);
    // Bug 1.3/1.4: a line matched to a master item now surfaces the readable
    // master code on read (instead of null), so the detail/edit form shows it.
    expect(detail.lines[0]?.itemCodeText).toBe(firstItemCode);
    // line rate numeric formatting
    expect(detail.lines[0]?.rate).toBe('35.50');
    // GST % defaults to 18 on the header (migration 0061, parity with SO).
    expect(detail.gstPercent).toBe('18.00');
    // ADR-203: server-numbered lines, each with its customer RM.
    expect(detail.lines[1]?.lineNo).toBe(2);
    expect(detail.lines[0]?.rmItemCode).toBe(`${firstItemCode}-RM`);
    expect(detail.lines[0]?.partyMaterialId).not.toBeNull();
    expect(detail.lines[0]?.inUse).toBe(false);
  });

  it('createJobWorkOrder auto-generates the next IN-JW code when omitted (bug 1.2)', async () => {
    const detail = await service.createJobWorkOrder(
      {
        header: { jwDate: '2026-05-03', customerName: 'Auto Code Co', clientId: firstClientId },
        lines: [
          { partName: 'Auto', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
        ],
      },
      admin,
    );
    expect(detail.code).toMatch(/^IN-JW-\d{5}$/);
    // Generated codes don't carry TEST_PREFIX, so clean up explicitly.
    await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, detail.id));
    await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, detail.id));
  });

  it('two quick JWSO creates get distinct sequential IN-JW codes (bug 2)', async () => {
    const mk = () =>
      service.createJobWorkOrder(
        {
          header: { jwDate: '2026-05-03', customerName: 'Seq Co', clientId: firstClientId },
          lines: [
            { partName: 'Seq', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
          ],
        },
        admin,
      );
    const a = await mk();
    const b = await mk();
    expect(a.code).not.toBe(b.code);
    expect(Number(b.code.slice(-5))).toBe(Number(a.code.slice(-5)) + 1);
    for (const id of [a.id, b.id]) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, id));
      await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, id));
    }
  });

  it('createJobWorkOrder rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Dup Co', clientId: firstClientId },
        lines: [
          { partName: 'X', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
        ],
      },
      admin,
    );
    await expect(
      service.createJobWorkOrder(
        {
          header: { code, jwDate: '2026-05-02', customerName: 'Dup Co', clientId: firstClientId },
          lines: [
            { partName: 'X', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createJobWorkOrder rejects invalid clientId with ValidationError', async () => {
    await expect(
      service.createJobWorkOrder(
        {
          header: {
            code: `${TEST_PREFIX}BADCLI`,
            jwDate: '2026-05-02',
            clientId: '00000000-0000-0000-0000-000000000000',
          },
          lines: [
            { partName: 'X', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getJobWorkOrder returns header + lines ordered by lineNo', async () => {
    const code = `${TEST_PREFIX}G1`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Gettable', clientId: firstClientId },
        lines: [
          {
            partName: 'Line One',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 3,
          },
          {
            partName: 'Line Two',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 7,
          },
        ],
      },
      admin,
    );
    const fetched = await service.getJobWorkOrder(created.id, admin);
    expect(fetched.id).toBe(created.id);
    expect(fetched.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(fetched.lines[0]?.partName).toBe('Line One');
  });

  it('getJobWorkOrder throws NotFoundError for unknown id', async () => {
    await expect(
      service.getJobWorkOrder('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listJobWorkOrders returns ONE row per JWSO with line aggregates + status filter', async () => {
    const code = `${TEST_PREFIX}LST`;
    await service.createJobWorkOrder(
      {
        header: {
          code,
          jwDate: '2026-05-02',
          customerName: 'Listable',
          clientId: firstClientId,
        },
        lines: [
          {
            partName: 'A',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 4,
            rate: 10,
          },
          {
            partName: 'B',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 6,
            rate: 20,
          },
        ],
      },
      admin,
    );
    const result = await service.listJobWorkOrders(
      { search: 'T031-LST', status: 'open', limit: 50, offset: 0 },
      admin,
    );
    // ONE row for the whole JWSO (#6), aggregating its 2 lines.
    const rowsForJw = result.items.filter((j) => j.code === code);
    expect(rowsForJw).toHaveLength(1);
    const row = rowsForJw[0];
    expect(row?.lineCount).toBe(2);
    expect(row?.totalQty).toBe(10); // 4 + 6
    // ADR-203: both lines have a customer RM → 1 RM piece per finished part.
    expect(row?.rmRequiredQty).toBe(10);
    expect(row?.partyReceivedQty).toBe(0);
    expect(row?.jcQty).toBe(0);
  });

  it('updateJobWorkOrder header-only does NOT touch lines', async () => {
    const code = `${TEST_PREFIX}UH1`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Before', clientId: firstClientId },
        lines: [
          { partName: 'Stay', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 9 },
        ],
      },
      admin,
    );
    const updated = await service.updateJobWorkOrder(
      created.id,
      { header: { customerName: 'After', remarks: 'changed' } },
      admin,
    );
    expect(updated.customerName).toBe('After');
    expect(updated.remarks).toBe('changed');
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]?.id).toBe(created.lines[0]?.id);
    expect(updated.lines[0]?.partName).toBe('Stay');
  });

  it('updateJobWorkOrder merges lines: id-matched updated, new inserted, absent soft-deleted', async () => {
    const code = `${TEST_PREFIX}UM1`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Merge', clientId: firstClientId },
        lines: [
          {
            partName: 'Keep+Update',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 10,
          },
          {
            partName: 'Drop Me',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 20,
          },
        ],
      },
      admin,
    );
    const keptId = created.lines[0]!.id;

    const updated = await service.updateJobWorkOrder(
      created.id,
      {
        header: {},
        lines: [
          {
            id: keptId,
            partName: 'Keep+Updated',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 11,
          },
          {
            partName: 'Brand New',
            clientPoLineNo: '1',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 30,
          },
          // "Drop Me" is omitted → soft-deleted
        ],
      },
      admin,
    );
    expect(updated.lines).toHaveLength(2);
    const kept = updated.lines.find((l) => l.id === keptId);
    const fresh = updated.lines.find((l) => l.id !== keptId);
    expect(kept?.partName).toBe('Keep+Updated');
    expect(kept?.orderQty).toBe(11);
    expect(fresh?.partName).toBe('Brand New');
    // ADR-203: a new line takes MAX(line_no incl. removed)+1 — "Drop Me" was
    // Ln 2, so the new line is Ln 3 (numbers are never reused).
    expect(fresh?.lineNo).toBe(3);

    const allRows = await db
      .select()
      .from(jobWorkOrderLines)
      .where(eq(jobWorkOrderLines.jobWorkOrderId, created.id));
    const dropped = allRows.find((l) => l.partName === 'Drop Me');
    expect(dropped).toBeDefined();
    expect(dropped?.deletedAt).not.toBeNull();
  });

  it('softDeleteJobWorkOrder soft-deletes header + all lines', async () => {
    const code = `${TEST_PREFIX}DEL`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Goner', clientId: firstClientId },
        lines: [
          { partName: 'L1', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
          { partName: 'L2', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 2 },
        ],
      },
      admin,
    );
    await service.softDeleteJobWorkOrder(created.id, admin);
    await expect(service.getJobWorkOrder(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    const lines = await db
      .select()
      .from(jobWorkOrderLines)
      .where(eq(jobWorkOrderLines.jobWorkOrderId, created.id));
    expect(lines.every((l) => l.deletedAt !== null)).toBe(true);
  });

  it('emits CREATE / EDIT / DELETE activity_log rows atomic with the mutation', async () => {
    const code = `${TEST_PREFIX}AUD`;
    const created = await service.createJobWorkOrder(
      {
        header: {
          code,
          jwDate: '2026-05-02',
          customerName: 'Audit Customer',
          clientId: firstClientId,
        },
        lines: [
          { partName: 'L1', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
        ],
      },
      admin,
    );
    await service.updateJobWorkOrder(
      created.id,
      { header: { customerName: 'Audit Customer (renamed)' } },
      admin,
    );
    await service.softDeleteJobWorkOrder(created.id, admin);

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, code)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'DELETE', 'EDIT']);
    for (const r of auditRows) {
      expect(r.entity).toBe('JobWorkOrder');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(code);
    }
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.createJobWorkOrder(
        {
          header: {
            code: `${TEST_PREFIX}NOC`,
            jwDate: '2026-05-02',
            customerName: 'X',
          },
          lines: [
            { partName: 'L', clientPoLineNo: '1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
          ],
        },
        noCompanyUser,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ADR-232 (owner, 2026-10-15): the Access Control ticks alone decide; the
// derived role never refuses. Unknown id → a gate pass shows as a non-auth error.
describe('updateJobWorkOrder — ticks decide (ADR-232)', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

  it('sales L3 with role operator passes the gate', async () => {
    const user = asAccess(admin, { departments: { sales: 'L3' } }, 'operator');
    await expect(
      service.updateJobWorkOrder(UNKNOWN_ID, {} as never, user),
    ).rejects.not.toBeInstanceOf(AuthorizationError);
  });

  it('sales L2 (no tick) is refused', async () => {
    const user = asAccess(admin, { departments: { sales: 'L2' } }, 'manager');
    await expect(service.updateJobWorkOrder(UNKNOWN_ID, {} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(service.updateJobWorkOrder(UNKNOWN_ID, {} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('delete: sales L5 Department Admin is refused (Super Admin only)', async () => {
    const user = asAccess(admin, { departments: { sales: 'L5' } }, 'manager');
    await expect(service.softDeleteJobWorkOrder(UNKNOWN_ID, user, 'test')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('delete: Super Admin passes the gate', async () => {
    await expect(
      service.softDeleteJobWorkOrder(UNKNOWN_ID, admin, 'test'),
    ).rejects.not.toBeInstanceOf(AuthorizationError);
  });
});

// ADR-236: POL is compulsory on every JWSO line; the line Remarks is optional.
// Both are the JWSO line's own facts — not locked by ADR-203's in-use rule.
describe('JWSO line POL + Remarks (ADR-236)', () => {
  it('create stores POL and Remarks; the detail returns both', async () => {
    const created = await service.createJobWorkOrder(
      {
        header: { code: `${TEST_PREFIX}POL1`, jwDate: '2026-05-02', clientId: firstClientId },
        lines: [
          {
            partName: 'Pol Part',
            clientPoLineNo: '20',
            remarks: 'urgent',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 2,
          },
        ],
      },
      admin,
    );
    const fetched = await service.getJobWorkOrder(created.id, admin);
    expect(fetched.lines[0]?.clientPoLineNo).toBe('20');
    expect(fetched.lines[0]?.remarks).toBe('urgent');
  });

  it('edit changes POL 20→21 and clears Remarks; History names POL and Remarks', async () => {
    const code = `${TEST_PREFIX}POL2`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', clientId: firstClientId },
        lines: [
          {
            partName: 'Pol Part',
            clientPoLineNo: '20',
            remarks: 'urgent',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 2,
          },
        ],
      },
      admin,
    );
    const lineId = created.lines[0]!.id;
    const updated = await service.updateJobWorkOrder(
      created.id,
      {
        header: {},
        lines: [
          {
            id: lineId,
            partName: 'Pol Part',
            clientPoLineNo: '21',
            remarks: null,
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 2,
          },
        ],
      },
      admin,
    );
    expect(updated.lines[0]?.clientPoLineNo).toBe('21');
    expect(updated.lines[0]?.remarks).toBeNull();

    const edits = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, admin.companyId!),
          eq(activityLog.refId, code),
          eq(activityLog.action, 'EDIT'),
        ),
      );
    const labels = edits.flatMap((r) => (r.changes ?? []).map((c) => c.label));
    expect(labels).toContain('POL');
    expect(labels).toContain('Remarks');
  });

  it('an absent remarks key leaves the stored Remarks alone', async () => {
    const created = await service.createJobWorkOrder(
      {
        header: { code: `${TEST_PREFIX}POL3`, jwDate: '2026-05-02', clientId: firstClientId },
        lines: [
          {
            partName: 'Keep Note',
            clientPoLineNo: '5',
            remarks: 'keep me',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
          },
        ],
      },
      admin,
    );
    const updated = await service.updateJobWorkOrder(
      created.id,
      {
        header: {},
        lines: [
          {
            id: created.lines[0]!.id,
            partName: 'Keep Note',
            clientPoLineNo: '5',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
          },
        ],
      },
      admin,
    );
    expect(updated.lines[0]?.remarks).toBe('keep me');
  });

  it('a line already on a Job Card can still change its POL and Remarks', async () => {
    const created = await service.createJobWorkOrder(
      {
        header: { code: `${TEST_PREFIX}POL4`, jwDate: '2026-05-02', clientId: firstClientId },
        lines: [
          {
            partName: 'In Use',
            clientPoLineNo: '30',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 4,
          },
        ],
      },
      admin,
    );
    const lineId = created.lines[0]!.id;
    const jc = await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}JC-${Date.now()}`,
        jcDate: '2026-05-02',
        itemId: firstItemId,
        orderQty: 4,
        sourceJwLineId: lineId,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobCards.id });
    try {
      const updated = await service.updateJobWorkOrder(
        created.id,
        {
          header: {},
          lines: [
            {
              id: lineId,
              partName: 'In Use',
              clientPoLineNo: '31',
              remarks: 'customer moved the line',
              itemId: firstItemId,
              uom: 'NOS',
              orderQty: 4,
            },
          ],
        },
        admin,
      );
      expect(updated.lines[0]?.inUse).toBe(true);
      expect(updated.lines[0]?.clientPoLineNo).toBe('31');
      expect(updated.lines[0]?.remarks).toBe('customer moved the line');
    } finally {
      await db.delete(jobCards).where(eq(jobCards.id, jc[0]!.id));
    }
  });

  it('list search finds a JWSO by its line POL', async () => {
    const code = `${TEST_PREFIX}POL5`;
    await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', clientId: firstClientId },
        lines: [
          {
            partName: 'Searchable',
            clientPoLineNo: 'T031POLX9',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
          },
        ],
      },
      admin,
    );
    const result = await service.listJobWorkOrders(
      { search: 'T031POLX9', limit: 50, offset: 0 },
      admin,
    );
    expect(result.items.map((j) => j.code)).toContain(code);
  });
});

// ADR-202 line approval (2026-10): with Document Edit Approval ON, a JWSO is
// staged only once it is IN USE (lib/jw-line-state.ts jwsoInUse) or an edit
// already waits on it (jw-edit-registry jwsoEditGoesForApproval). Then every
// line change is a box — `line:<id>:<attr>`, `line:add:<n>`, `line:remove:<id>`
// — approved through the real writer; a doomed change is refused at request by
// rehearsing that writer. Integration tests: the house harness (TEST stack).
describe('JWSO edit-approval — in-use rule + line boxes', () => {
  let cfgExisted = false;
  let origDocEditApproval = false;
  const jcIds: string[] = [];

  beforeAll(async () => {
    const cfg = await db
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.companyId, admin.companyId!))
      .limit(1);
    if (cfg[0]) {
      cfgExisted = true;
      origDocEditApproval = cfg[0].docEditApproval;
      await db
        .update(approvalConfig)
        .set({ docEditApproval: true })
        .where(eq(approvalConfig.id, cfg[0].id));
    } else {
      await db.insert(approvalConfig).values({
        companyId: admin.companyId!,
        docEditApproval: true,
        poApproval: false,
        prApproval: false,
        invoiceApproval: false,
        createdBy: admin.id,
        updatedBy: admin.id,
      });
    }
  }, 180_000);

  afterAll(async () => {
    if (cfgExisted) {
      await db
        .update(approvalConfig)
        .set({ docEditApproval: origDocEditApproval })
        .where(eq(approvalConfig.companyId, admin.companyId!));
    } else {
      await db.delete(approvalConfig).where(eq(approvalConfig.companyId, admin.companyId!));
    }
    await db
      .delete(documentEditRequests)
      .where(like(documentEditRequests.docCode, `${TEST_PREFIX}%`));
    for (const id of jcIds) await db.delete(jobCards).where(eq(jobCards.id, id));
  }, 180_000);

  type LineSpec = { pol: string; qty: number };
  function newJw(suffix: string, lines: LineSpec[] = [{ pol: '20', qty: 2 }]) {
    return service.createJobWorkOrder(
      {
        header: { code: `${TEST_PREFIX}${suffix}`, jwDate: '2026-05-02', clientId: firstClientId },
        lines: lines.map((l) => ({
          partName: 'Gate Part',
          clientPoLineNo: l.pol,
          itemId: firstItemId,
          uom: 'NOS' as const,
          orderQty: l.qty,
        })),
      },
      admin,
    );
  }

  /** Put a Job Card on the line — the JWSO is then IN USE. Returns its code. */
  async function putJc(lineId: string, qty: number): Promise<string> {
    const code = `${TEST_PREFIX}JC-${Date.now()}-${jcIds.length}`;
    const jc = await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code,
        jcDate: '2026-05-02',
        itemId: firstItemId,
        orderQty: qty,
        sourceJwLineId: lineId,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobCards.id });
    jcIds.push(jc[0]!.id);
    return code;
  }

  const lineInput = (id: string | undefined, pol: string, qty: number) => ({
    ...(id ? { id } : {}),
    partName: 'Gate Part',
    clientPoLineNo: pol,
    itemId: firstItemId,
    uom: 'NOS' as const,
    orderQty: qty,
  });

  async function readJwLine(id: string) {
    const rows = await db.select().from(jobWorkOrderLines).where(eq(jobWorkOrderLines.id, id));
    return rows[0]!;
  }

  it('nothing downstream: a line edit applies directly even with the gate on', async () => {
    const jw = await newJw('LA1');
    const res = await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(jw.lines[0]!.id, '21', 3)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    );
    expect((res as DocumentEditStagedResult).staged).toBeUndefined();
    const line = await readJwLine(jw.lines[0]!.id);
    expect(line.clientPoLineNo).toBe('21');
    expect(line.orderQty).toBe(3);
  }, 180_000);

  it('in use: a qty change is staged as line:<id>:orderQty; approve → applied', async () => {
    const jw = await newJw('LA2');
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(lineId, '20', 5)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    const box = staged.request.changes.find((c) => c.id === `line:${lineId}:orderQty`);
    expect(box?.label).toBe('Line 1 · Order Qty');
    expect(box?.before).toBe(2);
    expect(box?.after).toBe(5);
    expect((await readJwLine(lineId)).orderQty).toBe(2); // untouched while pending

    await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: box!.id, decision: 'approve' }] },
      admin,
    );
    expect((await readJwLine(lineId)).orderQty).toBe(5);
  }, 180_000);

  it('in use: reject → the line is unchanged', async () => {
    const jw = await newJw('LA3');
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(lineId, '20', 6)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    const decided = await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [{ changeId: `line:${lineId}:orderQty`, decision: 'reject', reason: 'no' }],
      },
      admin,
    );
    expect(decided.status).toBe('rejected');
    expect((await readJwLine(lineId)).orderQty).toBe(2);
  }, 180_000);

  it('in use: add a line and remove an unused line — one box each, approve applies both', async () => {
    const jw = await newJw('LA4', [
      { pol: '20', qty: 2 },
      { pol: '30', qty: 3 },
    ]);
    const [l1, l2] = jw.lines;
    await putJc(l1!.id, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        // Line 2 left out (removed); a new line added.
        lines: [lineInput(l1!.id, '20', 2), lineInput(undefined, '40', 7)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    const add = staged.request.changes.find((c) => c.id === 'line:add:1');
    const remove = staged.request.changes.find((c) => c.id === `line:remove:${l2!.id}`);
    expect(add?.label.startsWith(`Add line · ${firstItemCode}`)).toBe(true);
    expect(add?.label.length).toBeLessThanOrEqual(80);
    expect(remove?.label.startsWith('Remove line 2')).toBe(true);
    expect(staged.request.changes).toHaveLength(2);

    await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: add!.id, decision: 'approve' },
          { changeId: remove!.id, decision: 'approve' },
        ],
      },
      admin,
    );
    const live = await db
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, jw.id), isNull(jobWorkOrderLines.deletedAt)));
    expect(live.map((l) => l.clientPoLineNo).sort()).toEqual(['20', '40']);
  }, 180_000);

  it('removing a line a Job Card uses is refused at request, naming the Job Card', async () => {
    const jw = await newJw('LA5', [
      { pol: '20', qty: 2 },
      { pol: '30', qty: 3 },
    ]);
    const jcCode = await putJc(jw.lines[0]!.id, 1);
    const err = await service
      .updateJobWorkOrderOrStage(
        jw.id,
        {
          header: { clientId: firstClientId },
          lines: [lineInput(jw.lines[1]!.id, '30', 3)],
          expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
        },
        admin,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toContain(jcCode);
    const pending = await db
      .select()
      .from(documentEditRequests)
      .where(
        and(eq(documentEditRequests.entityId, jw.id), eq(documentEditRequests.status, 'pending')),
      );
    expect(pending).toHaveLength(0);
  }, 180_000);

  it('qty below what is returned: refused at request, and at approval when it drifted', async () => {
    const jw = await newJw('LA6', [{ pol: '20', qty: 4 }]);
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    await db
      .update(jobWorkOrderLines)
      .set({ returnedQty: 3 })
      .where(eq(jobWorkOrderLines.id, lineId));
    const fresh = await service.getJobWorkOrder(jw.id, admin);
    // At request: 4 → 2 is below the 3 returned.
    await expect(
      service.updateJobWorkOrderOrStage(
        jw.id,
        {
          header: { clientId: firstClientId },
          lines: [lineInput(lineId, '20', 2)],
          expectedUpdatedAt: new Date(fresh.updatedAt).toISOString(),
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // At approval: 4 → 3 stages (floor 3), then 1 more is returned (floor 4).
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(lineId, '20', 3)],
        expectedUpdatedAt: new Date(fresh.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    await db
      .update(jobWorkOrderLines)
      .set({ returnedQty: 4 })
      .where(eq(jobWorkOrderLines.id, lineId));
    await expect(
      decideDocumentEdit(
        {
          id: staged.request.id,
          decisions: [{ changeId: `line:${lineId}:orderQty`, decision: 'approve' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await readJwLine(lineId)).orderQty).toBe(4);
  }, 180_000);

  it('partial approval: approve POL, reject qty → only POL is written', async () => {
    const jw = await newJw('LA7');
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(lineId, '21', 3)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: `line:${lineId}:clientPoLineNo`, decision: 'approve' },
          { changeId: `line:${lineId}:orderQty`, decision: 'reject', reason: 'keep qty' },
        ],
      },
      admin,
    );
    const line = await readJwLine(lineId);
    expect(line.clientPoLineNo).toBe('21');
    expect(line.orderQty).toBe(2);
  }, 180_000);

  it('in use: an unchanged resend (blank Remarks vs stored null) is no line box — the header stages', async () => {
    const jw = await newJw('LA8');
    await putJc(jw.lines[0]!.id, 1);
    const res = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId, remarks: 'header note' },
        lines: [{ ...lineInput(jw.lines[0]!.id, '20', 2), remarks: '' }],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(res.staged).toBe(true);
    expect(res.request.changes.map((c) => c.id)).toEqual(['remarks']);
  }, 180_000);

  // ── Code-review fixes (2026-10-26) ─────────────────────────────────────────

  it('stale request: in use turns off while an edit waits — a new edit is refused, not written beside it', async () => {
    const jw = await newJw('LA9');
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(lineId, '20', 5)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    // The Job Card goes away — nothing uses the JWSO any more.
    await db.update(jobCards).set({ deletedAt: new Date() }).where(eq(jobCards.sourceJwLineId, lineId));
    const err = await service
      .updateJobWorkOrderOrStage(
        jw.id,
        {
          header: { clientId: firstClientId },
          lines: [lineInput(lineId, '22', 2)],
          expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
        },
        admin,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toContain('already has an edit waiting');
    const l = await readJwLine(lineId);
    expect(l.clientPoLineNo).toBe('20');
    expect(l.orderQty).toBe(2);
  }, 180_000);

  it('add box: a line removed by someone else before approval marks the add superseded', async () => {
    const jw = await newJw('LA10', [
      { pol: '20', qty: 2 },
      { pol: '30', qty: 3 },
    ]);
    const [l1, l2] = jw.lines;
    await putJc(l1!.id, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(l1!.id, '20', 2), lineInput(l2!.id, '30', 3), lineInput(undefined, '40', 7)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    const add = staged.request.changes.find((c) => c.id === 'line:add:1');
    expect(String(add?.before)).toMatch(/^2 lines on the order \(ref [0-9a-f]{6}\)$/);
    // Someone else removes line 2 meanwhile.
    await db
      .update(jobWorkOrderLines)
      .set({ deletedAt: new Date() })
      .where(eq(jobWorkOrderLines.id, l2!.id));
    const decided = await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: add!.id, decision: 'approve' }] },
      admin,
    );
    expect(decided.decisions.find((d) => d.changeId === add!.id)?.outcome).toBe('superseded');
    const live = await db
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, jw.id), isNull(jobWorkOrderLines.deletedAt)));
    expect(live.map((l) => l.clientPoLineNo)).toEqual(['20']);
  }, 180_000);

  it('add box: approving add 1 and then add 2 in two clicks applies both (own adds are not drift)', async () => {
    const jw = await newJw('LA11');
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [lineInput(lineId, '20', 2), lineInput(undefined, '40', 4), lineInput(undefined, '50', 5)],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: 'line:add:1', decision: 'approve' }] },
      admin,
    );
    const decided = await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: 'line:add:2', decision: 'approve' }] },
      admin,
    );
    expect(decided.status).toBe('approved');
    expect(decided.decisions.map((d) => d.outcome)).toEqual(['approved', 'approved']);
    const live = await db
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, jw.id), isNull(jobWorkOrderLines.deletedAt)));
    expect(live.map((l) => l.clientPoLineNo).sort()).toEqual(['20', '40', '50']);
  }, 180_000);

  it('§20: the direct write re-checks in use under its own locks — a JWSO that came into use is refused 409', async () => {
    const jw = await newJw('LA12');
    const lineId = jw.lines[0]!.id;
    // The engine looked first and found nothing using it; a Job Card lands
    // before the direct write takes its locks.
    await putJc(lineId, 1);
    const err = await withUserContext(admin, (tx) =>
      service.updateJobWorkOrderTx(
        tx,
        jw.id,
        {
          header: { clientId: firstClientId },
          lines: [lineInput(lineId, '23', 2)],
          expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
        },
        admin,
        { requireNotLive: true },
      ),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe(
      'This Job Work Order is now in use — save again and the change will go for approval.',
    );
    expect((await readJwLine(lineId)).clientPoLineNo).toBe('20');
  }, 180_000);

  it('CODE/REV: item and Rev are ONE box on a JWSO line; approve writes the Rev', async () => {
    const jw = await newJw('LA13');
    const lineId = jw.lines[0]!.id;
    await putJc(lineId, 1);
    const staged = (await service.updateJobWorkOrderOrStage(
      jw.id,
      {
        header: { clientId: firstClientId },
        lines: [{ ...lineInput(lineId, '20', 2), revision: 'B' }],
        expectedUpdatedAt: new Date(jw.updatedAt).toISOString(),
      },
      admin,
    )) as DocumentEditStagedResult;
    const ids = staged.request.changes.map((c) => c.id);
    expect(ids).toEqual([`line:${lineId}:codeRev`]);
    const box = staged.request.changes[0]!;
    expect(box.label).toBe('Line 1 · CODE/REV');
    expect(box.before).toBe(firstItemCode);
    expect(box.after).toBe(`${firstItemCode}/B`);
    await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: box.id, decision: 'approve' }] },
      admin,
    );
    const l = await readJwLine(lineId);
    expect(l.revision).toBe('B');
    expect(l.itemId).toBe(firstItemId);
  }, 180_000);
});
