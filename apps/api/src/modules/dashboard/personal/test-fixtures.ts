// ADR-250 — shared fixtures for the home unit tests (no database, no imports
// that open one). Imported only by *.unit.test.ts files.

import { accessFormPermsSchema, type EffectiveAccess } from '@innovic/shared';
import type { DashAccess } from '../access';
import type { RawRow } from './list-query';
import type { ActivityEvent } from './notifications';

export type Dash = DashAccess;
export const dash = (eff: Partial<EffectiveAccess>, isAdmin = false): Dash => ({
  role: isAdmin ? 'admin' : 'manager',
  isAdmin,
  isManager: !isAdmin,
  eff: {
    fullAccess: false,
    auditor: false,
    drawingDownload: false,
    departments: {},
    forms: {},
    ...eff,
  },
});
export const perms = (p: Record<string, boolean>) =>
  accessFormPermsSchema.parse({ view: false, entry: false, edit: false, ...p });

export const raw = (over: Partial<RawRow> = {}): RawRow => ({
  rowKey: 'r1',
  id: '11111111-1111-4111-8111-111111111111',
  code: 'IN-PO-00001',
  kind: null,
  docDate: '2026-10-20',
  dueDate: null,
  party: 'Vendor A',
  itemCode: 'ITM-1',
  itemName: 'Shaft',
  qty: 10,
  uom: 'NOS',
  amount: 5000,
  createdBy: 'me',
  isLate: false,
  x1: null,
  x2: null,
  x3: null,
  ...over,
});
export const rowCtx = (a: Dash, money: string[] = []) => ({
  a,
  today: '2026-10-22',
  userId: 'me',
  showMoney: new Set(money) as unknown as ReadonlySet<never>,
});

export const ev = (over: Partial<ActivityEvent>) => ({
  id: 'e1',
  ts: new Date('2026-10-22T05:00:00Z'),
  entity: 'PurchaseRequest',
  action: 'APPROVE',
  entityId: 'd1',
  refId: 'IN-PR-1',
  userId: 'other',
  actor: 'Rakesh',
  qty: null,
  opRef: null,
  ...over,
});
