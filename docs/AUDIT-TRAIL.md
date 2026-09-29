# AUDIT-TRAIL.md — how a service logs, how a page shows History (ADR-197)

> The developer guide for the accountability foundation. Every module that
> records an action follows this file. Decision record: ADR-197 in
> `docs/DECISIONS.md`. Columns: `docs/SCHEMA.md` → "`activity_log` —
> accountability columns". Names: `docs/NAMING.md` (rows tagged ADR-197).

## The rule

Every action on every document writes **one `activity_log` row, inside the same
transaction as the change**, recording:

| Requirement §3.1 | Field on the row                                  | How                                                                 |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Who              | `user_id`, `user_full_name`                       | automatic — from the logged-in user                                 |
| Who (on floor)   | `operatorName`                                    | the operator / inspector typed on the entry, when not the user      |
| What             | `action`                                          | ONE `ActivityAction` constant — never a new string                  |
| Where            | `entity`, `entityId`, `refId`, `lineRef`, `opRef` | the DOCUMENT header + where inside it                               |
| Qty              | `qty`                                             | the quantity this action moved (good qty, sent qty, scrapped qty …) |
| Before → After   | `changes`                                         | `diffFields(before, after, FIELDS)`                                 |
| When             | `ts`                                              | automatic                                                           |
| Why              | `reason`                                          | REQUIRED for REJECT, REVERSE, CLOSE_SHORT, CANCEL, DELETE           |

## The API (all in place — import, do not copy)

```ts
// apps/api/src/modules/activity-log/service.ts
export async function emitActivityLog(
  tx: DbTransaction,
  input: ActivityLogInput,
  companyId: string,
  user: AuthContext,
): Promise<void>;

export interface ActivityLogInput {
  action: ActivityAction | (string & {}); // use ActivityAction.X
  entity: ActivityEntity | (string & {}); // the DOCUMENT type, CamelCase
  detail?: string; // one-line summary (global Activity Log)
  refId?: string | null; // document code, e.g. IN-PO-00012
  entityId?: string | null; // document uuid (header row)
  lineRef?: string | null; // "Line 2"
  opRef?: string | null; // "Op 20 · Turning"
  qty?: number | string | null;
  changes?: ActivityChange[] | null; // from diffFields
  reason?: string | null;
  operatorName?: string | null;
}
// appendActivityLog(input, user) — same, in its own transaction (rarely right:
// prefer emitActivityLog inside the write's transaction).

// apps/api/src/lib/audit-trail.ts
export function diffFields(
  before: object,
  after: object,
  fields: readonly DiffField[],
): ActivityChange[];
export interface DiffField {
  key: string;
  label: string;
  format?: (value: unknown) => ActivityChangeValue;
}
export function softDeleteStamp(user: { id: string }): { deletedAt: Date; deletedBy: string };
export function restoreStamp(): { deletedAt: null; deletedBy: null };
```

Shared (`@innovic/shared`, file `packages/shared/src/enums/activity.ts` and
`schemas/activity-log.ts`): `ActivityAction`, `ACTIVITY_ACTION_LABEL`,
`activityActionLabel()`, `REASON_REQUIRED_ACTIONS`, `activityReasonSchema`,
`ACTIVITY_ENTITIES`, `ACTIVITY_ENTITY_META`, `canonicalActivityAction()`,
`canonicalActivityEntity()`, `ActivityChange`, `ActivityHistoryRow`,
`activityHistoryQuerySchema`, `activityHistoryResponseSchema`.

## Which action

| Event                                                              | `action`                           |
| ------------------------------------------------------------------ | ---------------------------------- |
| Document / line created; rework or repair JC raised                | `CREATE`                           |
| Any field edited (PO revision too — put the revision in `changes`) | `EDIT`                             |
| Machine / vendor changed on an op                                  | `EDIT` (with `opRef`, `changes`)   |
| Sent for approval                                                  | `SUBMIT`                           |
| Approved / rejected / approval withdrawn                           | `APPROVE` / `REJECT` / `WITHDRAW`  |
| Op time change asked for (then `APPROVE` / `REJECT` on it)         | `REQUEST`                          |
| Op started (no qty)                                                | `START`                            |
| Op stopped / logged (good + reject)                                | `LOG`                              |
| QC result — in-process, final, TPI, **Incoming QC on a GRN**       | `QC`                               |
| Sent to vendor: DC issue, outsource balance, RTV                   | `SEND`                             |
| Received back: DC receipt, RTV received                            | `RECEIVE`                          |
| Store issue / return                                               | `ISSUE` / `RETURN`                 |
| Reached done by itself (auto roll-up)                              | `COMPLETE`                         |
| Close / close short / reopen                                       | `CLOSE` / `CLOSE_SHORT` / `REOPEN` |
| Wrong entry cancelled by an opposite entry (original stays)        | `REVERSE`                          |
| Cancel / delete / restore                                          | `CANCEL` / `DELETE` / `RESTORE`    |
| NC disposition decided / split                                     | `DISPOSE` / `SPLIT`                |
| Payment recorded                                                   | `PAYMENT`                          |
| Stock count posted                                                 | `POST`                             |

Never invent a new action string. If none fits, add it to `ActivityAction` (+ its
label, + badge colour in `apps/web/src/modules/activity-log/lib/activity-entity.ts`)
and to NAMING.md in the same commit.

## Which entity

`entity` + `entityId` are always the **document header** — `JobCard` for an op
start, `PurchaseOrder` for a PO line edit, `NonConformance` for a disposition.
The line / op goes in `lineRef` / `opRef`. Use the CamelCase names in
`ACTIVITY_ENTITIES` (`SalesOrder`, `JobCard`, `PurchaseOrder`,
`GoodsReceiptNote`, `DeliveryChallan`, `NonConformance`, `ProductionOrder`, …),
never the spaced legacy spellings. A document code can change (PO `/R1`
revisions) — `entityId` cannot, so **always pass `entityId`**.

When one action touches two documents (PR converted to a PO), write one row per
document, each with its own `entity` / `entityId`.

## Examples

### Create

```ts
await emitActivityLog(
  tx,
  {
    action: ActivityAction.Create,
    entity: 'PurchaseOrder',
    entityId: header.id,
    refId: header.code,
    detail: `${header.code} for ${vendorCode}`,
  },
  companyId,
  user,
);
```

### Edit, with before → after

```ts
import { diffFields } from '../../lib/audit-trail';

// Screen labels from docs/NAMING.md. `format` turns ids / dates into what a person reads.
const PO_FIELDS = [
  {
    key: 'vendorId',
    label: 'Vendor',
    format: (v: unknown) => vendorCodeById.get(String(v)) ?? null,
  },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'remarks', label: 'Remarks' },
] as const;

const before = existing; // the row as read BEFORE the update
const changes = diffFields(before, input, PO_FIELDS);
// ... perform the update ...
if (changes.length > 0) {
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: 'PurchaseOrder',
      entityId: before.id,
      refId: newCode, // the code AFTER a revision bump
      changes,
      detail: `Edited ${newCode}`,
    },
    companyId,
    user,
  );
}
```

Line edits: one row per changed line, `lineRef: \`Line ${line.lineNo}\``, with
that line's `changes`(e.g.`{ field: 'orderQty', label: 'Order Qty', before: 10, after: 12 }`).
Read `before` inside the same transaction, before the UPDATE.

### Delete (soft) and restore

```ts
import { restoreStamp, softDeleteStamp } from '../../lib/audit-trail';

const body = deleteInputSchema.parse(req.body); // { reason: activityReasonSchema }
await tx
  .update(goodsReceiptNotes)
  .set({ ...softDeleteStamp(user), updatedBy: user.id, updatedAt: new Date() })
  .where(eq(goodsReceiptNotes.id, id));
await emitActivityLog(
  tx,
  {
    action: ActivityAction.Delete,
    entity: 'GoodsReceiptNote',
    entityId: id,
    refId: grn.code,
    reason: body.reason,
  },
  companyId,
  user,
);

// restore
await tx
  .update(goodsReceiptNotes)
  .set({ ...restoreStamp(), updatedBy: user.id })
  .where(eq(goodsReceiptNotes.id, id));
await emitActivityLog(
  tx,
  { action: ActivityAction.Restore, entity: 'GoodsReceiptNote', entityId: id, refId: grn.code },
  companyId,
  user,
);
```

### Production: Start, Log, QC (user + operator + qty)

```ts
const opRef = `Op ${opSrNo(op.seq)} · ${op.operationName}`;

// Start — no qty
await emitActivityLog(
  tx,
  {
    action: ActivityAction.Start,
    entity: 'JobCard',
    entityId: jc.id,
    refId: jc.code,
    opRef,
    operatorName: input.operatorName,
    detail: `${jc.code} ${opRef} — started on ${machineCode}`,
  },
  companyId,
  user,
);

// Stop / Log — qty = good pieces; rejects in the detail (and an NC row of its own)
await emitActivityLog(
  tx,
  {
    action: ActivityAction.Log,
    entity: 'JobCard',
    entityId: jc.id,
    refId: jc.code,
    opRef,
    operatorName: input.operatorName,
    qty: input.completedQty,
    detail: `${jc.code} ${opRef} — ${input.completedQty} good, ${input.rejectedQty} rejected`,
  },
  companyId,
  user,
);

// QC — the inspector is `operatorName`
await emitActivityLog(
  tx,
  {
    action: ActivityAction.QC,
    entity: 'JobCard',
    entityId: jc.id,
    refId: jc.code,
    opRef,
    operatorName: input.inspectorName,
    qty: input.acceptedQty,
    detail: `${input.acceptedQty} accepted, ${input.rejectedQty} rejected`,
  },
  companyId,
  user,
);
```

Incoming QC on a GRN logs `action: QC, entity: 'GoodsReceiptNote'`, with
`lineRef` and `qty` = accepted — never `EDIT`.

### Reason-required actions (REJECT, REVERSE, CLOSE_SHORT, CANCEL, DELETE)

The reason is refused at the door, in the shared input schema — not in
`emitActivityLog`:

```ts
// packages/shared — the module's input schema
export const rejectPurchaseRequestInputSchema = z.object({ reason: activityReasonSchema });

// service
await tx
  .update(purchaseRequests)
  .set({
    status: 'cancelled',
    rejectedBy: user.id,
    rejectedAt: now,
    rejectionReason: input.reason,
    updatedBy: user.id,
    updatedAt: now,
  })
  .where(eq(purchaseRequests.id, id));
await emitActivityLog(
  tx,
  {
    action: ActivityAction.Reject,
    entity: 'PurchaseRequest',
    entityId: id,
    refId: pr.code,
    reason: input.reason,
    qty: pr.qty,
  },
  companyId,
  user,
);
```

A **REVERSE** keeps the original entry and writes an opposite one; its log row
names the entry it cancels in `detail` (e.g. `Reverses LOG-00123`) and carries
the reversed `qty` and the `reason`.

### "By" columns to fill (0178)

| Action                          | Set on the document                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| PR reject                       | `rejectedBy`, `rejectedAt`, `rejectionReason`                                       |
| OSP DC issue / receive / cancel | `issuedBy/At`, `receivedBy/At`, `cancelledBy/At`                                    |
| NC disposition                  | `dispositionBy`, `dispositionAt` (keep writing `dispositionByText` as the snapshot) |
| Any soft delete                 | `...softDeleteStamp(user)` (restore: `...restoreStamp()`)                           |

## A page: the History tab

Pages pass the document's **id and code** (legacy rows are found by code only).

**Page that shows the Related Documents strip** (SO, JWSO, PO …):

```tsx
import { useHistoryTab } from '@/components/shared/document-history';

const historyTab = useHistoryTab({ entity: 'PurchaseOrder', entityId: po.id, refId: po.code });
<RelatedDocsTabs module="purchase-orders" id={po.id} extraTabs={[...otherTabs, historyTab]} />;
```

The tab hides itself while the document has no history (count 0), like every
extra tab. Call the hook unconditionally (hooks rule) — before any early return.

**Any other page** — render the table in a panel:

```tsx
import { DocumentHistory } from '@/components/shared/document-history';

<Panel title="History" bodyPadding="none">
  <DocumentHistory entity="NonConformance" entityId={nc.id} refId={nc.code} />
</Panel>;
```

`<DocumentHistory entity entityId? refId? emptyText? />` renders one line per
action: Log Date · Log Time · User (+ Operator) · Action (+ line / op) ·
Activity Qty · Before → After (legacy rows: their detail line) · Reason.
Data hook: `useDocumentHistory({ entity, entityId, refId })` from
`@/modules/activity-log/api`. After a mutation, invalidate
`activityLogKeys.all` so the tab refreshes.

Server: `GET /activity-log/history?entity=&entityId=&refId=` — company-scoped,
newest first, max 500 (default 200). Allowed when the user may `view` the
document's own Access Control form (`ACTIVITY_ENTITY_META[entity].viewForm`);
entities without one fall back to the Activity Log's department (Tasks & Alerts).

## Checklist for a module

- [ ] Every write path emits exactly one row per document touched, inside the write's transaction.
- [ ] `action` is an `ActivityAction`; `entity` is a CamelCase `ACTIVITY_ENTITIES` name.
- [ ] `entityId` + `refId` always; `lineRef` / `opRef` when the action is on a line / op.
- [ ] `qty` whenever quantity moved; `operatorName` whenever an operator / inspector was named.
- [ ] Edits use `diffFields` and skip the row when nothing changed.
- [ ] Reason-required actions take `activityReasonSchema` in the input and pass `reason`.
- [ ] Soft deletes use `softDeleteStamp(user)`; restores `restoreStamp()`.
- [ ] The detail page has the History tab (id + code passed).
- [ ] New labels / fields registered in `docs/NAMING.md`.
