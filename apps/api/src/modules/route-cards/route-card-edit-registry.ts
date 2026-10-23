// Route Card entry for the edit-approval engine (ADR-202; ADR-249 Step B2).
//
// Boxes (owner chose the smallest approach):
//   - the header fields the Route Card edit form can change — RC No., Item
//     Code, Plan Type, Notes — one box each;
//   - the whole routing (every operation + the raw material) as ONE box,
//     "Operations", whose before / after is the canonical text summary from
//     ./route-card-edit-common.ts. The engine's freshness check compares that
//     text, so ANY drift in the stored routing since the request (an op, a
//     tool number, a remark, the RM) marks the box superseded.
//
// applyEdit rebuilds a FULL edit input from the CURRENT card, overwrites only
// the approved boxes, and replays it through updateRouteCardTx — the writer
// PUT uses — so the approved edit gets the same checks, revision bump, plan
// backfill and History rows as a direct save. No second writer.
//
// Lock order (CLAUDE.md §20.3): plans → route_cards, as updateRouteCard and
// executePlan already do. loadForDiff therefore pre-locks the item's backfill
// candidate plans before the card row — except when the request is being
// staged from inside a Job Card / Plan transaction that already holds its own
// plan row (stagingFromSourceDoc); see the note there.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, CreateRouteCardOpInput, UpdateRouteCardInput } from '@innovic/shared';
import { routeCardOps, routeCards } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import { NotFoundError } from '../../lib/errors';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { lockBackfillCandidates } from '../plans/rm-backfill';
import {
  ROUTING_FIELD,
  ROUTING_LABEL,
  type RouteCardEditPayload,
  routingSummary,
  stagingFromSourceDoc,
} from './route-card-edit-common';
import {
  gradeName,
  loadCodes,
  opInputFromRow,
  sizeName,
  summaryOpsFromInput,
  summaryOpsFromRows,
} from './route-card-edit-lookups';
import {
  labelOf,
  overwriteRouteCardFromSource,
  PLAN_TYPE_LABEL,
  rmHalvesToFill,
  updateRouteCardTx,
} from './service';

const RC_FORM_KEY: AccessFormKey = 'routecard_create';

// Labels are the Route Card form's own (the same RC_HEADER_FIELDS the History
// tab uses — docs/NAMING.md). No Item Code box: moving a card to another item
// is refused before staging (updateRouteCardOrStage, §20.3 lock order).
type HeaderKey = 'code' | 'planType' | 'notes';
const HEADER_KEYS: ReadonlySet<string> = new Set<HeaderKey>(['code', 'planType', 'notes']);

const RC_EDIT_DIFF_FIELDS: readonly DiffField[] = [
  { key: 'code', label: 'RC No.' },
  { key: 'planType', label: 'Plan Type', format: labelOf(PLAN_TYPE_LABEL) },
  { key: 'notes', label: 'Notes' },
  { key: ROUTING_FIELD, label: ROUTING_LABEL },
];

type RcRow = typeof routeCards.$inferSelect;

const RM_KEYS = [
  'rawMaterialGradeId',
  'rawMaterialGradeText',
  'rawMaterialSizeId',
  'rawMaterialSizeText',
  'rawMaterialItemId',
  'rmQtyPerPiece',
] as const;
type RmPart = Pick<UpdateRouteCardInput, (typeof RM_KEYS)[number]>;

interface FilteredRcEdit {
  header: Partial<Record<HeaderKey, unknown>>;
  /** The proposed routing (ops + raw material), only when "Operations" was approved. */
  routing: { ops: CreateRouteCardOpInput[]; rm: RmPart } | null;
  revisionNote: string | null;
  /** Set = a routing change proposed by a Job Card / plan (not the form). */
  sourceCode: string | null;
  fillRm: boolean;
}

export const routeCardEditRegistryEntry: DocEditRegistryEntry = {
  formKey: RC_FORM_KEY,

  diffFields() {
    return RC_EDIT_DIFF_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const live = and(
      eq(routeCards.id, id),
      eq(routeCards.companyId, companyId),
      isNull(routeCards.deletedAt),
    );
    // LOCK ORDER — plans BEFORE route_cards (see header note). The card's item
    // is read without a lock only to name the plans; the backfill candidate
    // set keys on the PLANS' own columns, never on the card's values.
    const pre = await tx
      .select({ itemId: routeCards.itemId })
      .from(routeCards)
      .where(live)
      .limit(1);
    if (!pre[0]) return null;
    if (stagingFromSourceDoc.getStore() !== true) {
      await lockBackfillCandidates(tx, companyId, pre[0].itemId);
    }

    const rows = await tx.select().from(routeCards).where(live).limit(1).for('update');
    const rc = rows[0];
    if (!rc) return null;
    // Ops locked under the same scope, without a join (FOR UPDATE cannot touch
    // the nullable side of an outer join); codes resolved separately.
    const opRows = await tx
      .select()
      .from(routeCardOps)
      .where(
        and(
          eq(routeCardOps.routeCardId, id),
          eq(routeCardOps.companyId, companyId),
          isNull(routeCardOps.deletedAt),
        ),
      )
      .orderBy(asc(routeCardOps.opSeq))
      .for('update');

    const codes = await loadCodes(tx, companyId, {
      items: [rc.rawMaterialItemId],
      machines: opRows.map((o) => o.machineId),
      vendors: opRows.map((o) => o.ospVendorId),
    });
    const itemCodes = codes.items;

    const routing = routingSummary(summaryOpsFromRows(opRows, codes.machines, codes.vendors), {
      rawMaterialGradeText: rc.rawMaterialGradeText,
      rawMaterialSizeText: rc.rawMaterialSizeText,
      rawMaterialItemCode: rc.rawMaterialItemId
        ? (itemCodes.get(rc.rawMaterialItemId) ?? null)
        : null,
      rmQtyPerPiece: rc.rmQtyPerPiece,
    });

    return {
      doc: { ...rc, routing },
      updatedAt: rc.updatedAt,
      docCode: rc.code,
      // Any existing (not-Trash) card is LIVE; a gone one returned null above.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      code: d['code'],
      planType: d['planType'],
      notes: d['notes'] ?? null,
      [ROUTING_FIELD]: d['routing'],
    };
  },

  async afterSnapshot(tx, companyId, input, _user, target) {
    const i = input as RouteCardEditPayload;
    const stored = (target?.doc ?? {}) as Partial<RcRow>;

    // Raw material compared LIKE WITH LIKE: the same id as the card holds reads
    // as the card's stored text (no phantom difference from a renamed master);
    // a new id names its master row; no id → the typed text. The RM item pair
    // left out (undefined) keeps the stored pair, as the writer does.
    const sameOr = async (
      id: string | null | undefined,
      storedId: string | null | undefined,
      storedText: string | null | undefined,
      typed: string | null | undefined,
      lookup: (masterId: string) => Promise<string | null>,
    ): Promise<string | null> =>
      id ? (id === storedId ? (storedText ?? null) : await lookup(id)) : typed?.trim() || null;
    let gradeText = await sameOr(
      i.rawMaterialGradeId,
      stored.rawMaterialGradeId,
      stored.rawMaterialGradeText,
      i.rawMaterialGradeText,
      (gid) => gradeName(tx, companyId, gid),
    );
    let sizeText = await sameOr(
      i.rawMaterialSizeId,
      stored.rawMaterialSizeId,
      stored.rawMaterialSizeText,
      i.rawMaterialSizeText,
      (sid) => sizeName(tx, companyId, sid),
    );
    let rmItemId =
      i.rawMaterialItemId !== undefined ? i.rawMaterialItemId : (stored.rawMaterialItemId ?? null);
    let rmQty = i.rmQtyPerPiece !== undefined ? i.rmQtyPerPiece : (stored.rmQtyPerPiece ?? null);

    // A Job Card / plan proposal shows ONLY what overwriteRouteCardFromSource
    // would write: a half the card holds blank, and only if the proposer could
    // fill it (fillRm). Every other half reads as the card's own value.
    if (i.sourceCode) {
      const fill = i.fillRm
        ? rmHalvesToFill(
            {
              rawMaterialGradeText: stored.rawMaterialGradeText ?? null,
              rawMaterialSizeText: stored.rawMaterialSizeText ?? null,
              rawMaterialItemId: stored.rawMaterialItemId ?? null,
              rmQtyPerPiece: stored.rmQtyPerPiece ?? null,
            },
            {
              rawMaterialGradeId: i.rawMaterialGradeId ?? null,
              rawMaterialGradeText: gradeText,
              rawMaterialSizeId: i.rawMaterialSizeId ?? null,
              rawMaterialSizeText: sizeText,
              rawMaterialItemId: rmItemId,
              rmQtyPerPiece: rmQty,
            },
          )
        : { grade: false, size: false, rmItem: false };
      if (!fill.grade) gradeText = stored.rawMaterialGradeText ?? null;
      if (!fill.size) sizeText = stored.rawMaterialSizeText ?? null;
      if (!fill.rmItem) {
        rmItemId = stored.rawMaterialItemId ?? null;
        rmQty = stored.rmQtyPerPiece ?? null;
      }
    }

    const codes = await loadCodes(tx, companyId, {
      items: [rmItemId],
      machines: i.ops.map((o) => o.machineId),
      vendors: i.ops.map((o) => o.ospVendorId),
    });
    const itemCodes = codes.items;

    return {
      code: i.code,
      // Left out = the writer keeps the stored plan type, so not a change.
      ...(i.planType !== undefined ? { planType: i.planType } : {}),
      // The writer stores `notes ?? null`, so a left-out note clears it.
      notes: i.notes ?? null,
      [ROUTING_FIELD]: routingSummary(summaryOpsFromInput(i.ops, codes.machines, codes.vendors), {
        rawMaterialGradeText: gradeText,
        rawMaterialSizeText: sizeText,
        rawMaterialItemCode: rmItemId ? (itemCodes.get(rmItemId) ?? null) : null,
        rmQtyPerPiece: rmQty,
      }),
    };
  },

  buildFilteredInput(proposedPayload, approvedFields, ctx): FilteredRcEdit | null {
    const p = proposedPayload as RouteCardEditPayload;
    const record = p as unknown as Record<string, unknown>;
    const header: FilteredRcEdit['header'] = {};
    for (const f of approvedFields) {
      if (HEADER_KEYS.has(f)) header[f as HeaderKey] = record[f];
    }
    const routingApproved = approvedFields.has(ROUTING_FIELD);
    if (Object.keys(header).length === 0 && !routingApproved) return null;
    const rm: RmPart = {};
    for (const k of RM_KEYS) {
      if (p[k] !== undefined) (rm as Record<string, unknown>)[k] = p[k];
    }
    return {
      header,
      routing: routingApproved ? { ops: p.ops, rm } : null,
      // Only on the first call of this request that applies a change.
      revisionNote: ctx?.firstApply === false ? null : (p.revisionNote ?? null),
      sourceCode: p.sourceCode ?? null,
      fillRm: p.fillRm === true,
    };
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const f = filteredInput as FilteredRcEdit;
    // CURRENT card + ops (the engine already holds the row locks).
    const cur = (
      await tx
        .select()
        .from(routeCards)
        .where(
          and(
            eq(routeCards.id, id),
            eq(routeCards.companyId, companyId),
            isNull(routeCards.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!cur) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');

    // A routing change a Job Card / plan proposed is written by THE SAME path
    // that writes it with the gate off (overwriteRouteCardFromSource): same
    // rules, no Route Card form checks, blank-RM fill only if the proposer
    // could fill it — one Job Card, one card, gate on or off. Its header boxes
    // are the card's own values, so only "Operations" can be applied.
    if (f.sourceCode) {
      if (!f.routing) return;
      const rm = f.routing.rm;
      await overwriteRouteCardFromSource(
        tx,
        companyId,
        cur,
        f.routing.ops,
        {
          rawMaterialGradeId: rm.rawMaterialGradeId ?? null,
          rawMaterialGradeText: rm.rawMaterialGradeText ?? null,
          rawMaterialSizeId: rm.rawMaterialSizeId ?? null,
          rawMaterialSizeText: rm.rawMaterialSizeText ?? null,
          rawMaterialItemId: rm.rawMaterialItemId ?? null,
          rmQtyPerPiece: rm.rmQtyPerPiece ?? null,
        },
        user,
        f.sourceCode,
        () => Promise.resolve(f.fillRm),
      );
      return;
    }

    const h = f.header;
    let ops: CreateRouteCardOpInput[];
    let rm: RmPart;
    if (f.routing) {
      ops = f.routing.ops;
      rm = f.routing.rm;
    } else {
      // "Operations" not approved: the stored routing and RM are resubmitted
      // as they stand, so only the approved header boxes change.
      const curOps = await tx
        .select()
        .from(routeCardOps)
        .where(
          and(
            eq(routeCardOps.routeCardId, id),
            eq(routeCardOps.companyId, companyId),
            isNull(routeCardOps.deletedAt),
          ),
        )
        .orderBy(asc(routeCardOps.opSeq));
      ops = curOps.map(opInputFromRow);
      rm = {
        rawMaterialGradeId: cur.rawMaterialGradeId,
        rawMaterialGradeText: cur.rawMaterialGradeText,
        rawMaterialSizeId: cur.rawMaterialSizeId,
        rawMaterialSizeText: cur.rawMaterialSizeText,
        rawMaterialItemId: cur.rawMaterialItemId,
        rmQtyPerPiece: cur.rmQtyPerPiece,
      };
    }

    const input: UpdateRouteCardInput = {
      code: ('code' in h ? h.code : cur.code) as string,
      itemId: cur.itemId,
      // Not approved / left out → undefined: the writer keeps the stored plan type
      // (which may be 'assembly', a value the edit input cannot carry).
      planType: h.planType as UpdateRouteCardInput['planType'],
      notes: 'notes' in h ? ((h.notes as string | null | undefined) ?? null) : cur.notes,
      ...rm,
      ops,
      revisionNote: f.revisionNote,
      // The engine resolved per-box drift under this tx's lock, so the writer's
      // whole-row updated_at check must see the CURRENT token (a no-op match).
      expectedUpdatedAt: expectedUpdatedAt ?? undefined,
    };

    // Header-only approval: the stored routing + RM are not changing, so the
    // writer does not re-validate them (a grandfathered routing — QC after OSP
    // from a JC auto-save — must not block approving its Notes).
    await updateRouteCardTx(tx, id, input, user, { routingUnchanged: !f.routing });
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: routeCards.id, updatedAt: routeCards.updatedAt })
      .from(routeCards)
      .where(and(inArray(routeCards.id, ids), eq(routeCards.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
