// Guards + small helpers for the return-to-vendor DC save (create-nc-dc.ts),
// split out to keep that file reviewable. 0237 — one DC may carry several NCs
// of ONE Sales Order going to ONE vendor.

import { and, asc, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import { NC_STATUS_LABELS, withDocRevision } from '@innovic/shared';
import {
  deliveryChallanLines,
  deliveryChallans,
  ncRegister,
  purchaseOrderLines,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { labelOf } from '../../lib/status-labels';
import { type NcSource, resolveNcSource } from './cascades';
import { ncSoKeySql } from './so-key';

export type LockedNc = typeof ncRegister.$inferSelect;

/** The PO line's received figure, for the before/after audit around a recalc. */
export async function readPoLineReceived(
  tx: DbTransaction,
  poLineId: string,
): Promise<{ receivedQty: number; lineNo: number } | undefined> {
  const rows = await tx
    .select({ receivedQty: purchaseOrderLines.receivedQty, lineNo: purchaseOrderLines.lineNo })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.id, poLineId))
    .limit(1);
  return rows[0];
}

/** Next IN-DC-NNNNN/R1 for the company. A local copy of
 *  delivery-challans/service.ts nextDcCode, which is not exported: highest
 *  numeric suffix + 1, five digits, tolerating and ignoring a `/R<n>` tail so
 *  a revised challan keeps its running number. Kept identical on purpose —
 *  an NC challan and a PO challan share one number series. */
export async function nextNcDcCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: same series — and same lock — as the OSP challan (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'delivery_challans');
  const prefix = 'IN-DC-';
  const rows = await tx
    .select({ code: deliveryChallans.code })
    .from(deliveryChallans)
    .where(
      and(
        eq(deliveryChallans.companyId, companyId),
        isNull(deliveryChallans.deletedAt),
        like(deliveryChallans.code, `${prefix}%`),
      ),
    );
  let max = 0;
  for (const r of rows) {
    const m = r.code
      .trim()
      .slice(prefix.length)
      .match(/^(\d+)(?:\/R\d+)?$/i);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return withDocRevision(`${prefix}${String(max + 1).padStart(5, '0')}`, 1);
}

/** Lock every picked NC (one query, id order — deadlock-safe), then run the
 *  per-NC guards, the "no live DC holds it" check and the SAME-SO rule.
 *  Returns the NC rows in INPUT order (= line order on the challan). */
export async function lockNcsForDc(
  tx: DbTransaction,
  ncIds: string[],
  companyId: string,
): Promise<{ ncs: LockedNc[]; soCode: string | null }> {
  // S3 — every NC locked in ONE query, in id order, so two saves sharing NCs
  // always take the locks in the same order (no deadlock) and the second one
  // sees the first one's challan (deliveryChallanId below).
  const lockedRows = await tx
    .select({
      nc: ncRegister,
      soKey: ncSoKeySql('nc_register'),
      soCode: sql<string | null>`(
        SELECT kso.code FROM public.sales_orders kso
         WHERE kso.id = ${ncSoKeySql('nc_register')}
      )`,
    })
    .from(ncRegister)
    .where(
      and(
        inArray(ncRegister.id, ncIds),
        eq(ncRegister.companyId, companyId),
        isNull(ncRegister.deletedAt),
      ),
    )
    .orderBy(asc(ncRegister.id))
    .for('update', { of: ncRegister });
  if (lockedRows.length !== ncIds.length) {
    const missing = ncIds.length - lockedRows.length;
    throw new NotFoundError(
      ncIds.length === 1
        ? 'NC not found. It may have been moved to Trash.'
        : `${missing} of the ${ncIds.length} NCs picked were not found. They may have been moved to Trash — reload the page.`,
    );
  }
  const byId = new Map(lockedRows.map((r) => [r.nc.id, r]));
  // Input order = line order on the challan.
  const picked = ncIds.map((id) => byId.get(id)!);

  for (const { nc } of picked) {
    if (nc.disposition !== 'return_to_vendor') {
      throw new ConflictError(
        `NC ${nc.code} is not set to Return to Vendor. Change its disposition first.`,
      );
    }
    if (nc.status !== 'disposed') {
      throw new ConflictError(
        `NC ${nc.code} is ${labelOf(NC_STATUS_LABELS, nc.status)}. A DC can only be raised while it is Disposed.`,
      );
    }
    if (nc.deliveryChallanId) {
      throw new ConflictError(`NC ${nc.code} already has a return-to-vendor DC.`);
    }
  }

  // One ACTIVE return-to-vendor DC per NC, checked on the challans too — not
  // only on the NC's pointer: a DC whose HEADER names the NC (0181 index) or
  // whose LINE carries it (0237). Same rule as lib/rtv-predicates.ts.
  const codeOf = new Map(picked.map((r) => [r.nc.id, r.nc.code]));
  const headerHits = await tx
    .select({ ncId: deliveryChallans.ncId, code: deliveryChallans.code })
    .from(deliveryChallans)
    .where(
      and(
        inArray(deliveryChallans.ncId, ncIds),
        eq(deliveryChallans.companyId, companyId),
        isNull(deliveryChallans.deletedAt),
        ne(deliveryChallans.status, 'cancelled'),
      ),
    )
    .limit(1);
  const lineHits = headerHits[0]
    ? []
    : await tx
        .select({ ncId: deliveryChallanLines.ncId, code: deliveryChallans.code })
        .from(deliveryChallanLines)
        .innerJoin(
          deliveryChallans,
          eq(deliveryChallans.id, deliveryChallanLines.deliveryChallanId),
        )
        .where(
          and(
            inArray(deliveryChallanLines.ncId, ncIds),
            isNull(deliveryChallanLines.deletedAt),
            eq(deliveryChallans.companyId, companyId),
            isNull(deliveryChallans.deletedAt),
            ne(deliveryChallans.status, 'cancelled'),
          ),
        )
        .limit(1);
  const activeDc = headerHits[0] ?? lineHits[0];
  if (activeDc) {
    const ncCode = codeOf.get(activeDc.ncId ?? '') ?? '—';
    throw new ConflictError(
      `NC ${ncCode} already has return-to-vendor DC ${activeDc.code}. Reload the page.`,
    );
  }

  // SAME SO (owner rule): every NC on one DC shares one non-null SO key
  // (so-key.ts — the same SQL the picker's soId comes from). An NC with no SO
  // at all may only travel alone.
  if (picked.length > 1) {
    const noSo = picked.find((r) => !r.soKey);
    if (noSo) {
      throw new ConflictError(
        `${noSo.nc.code} is not linked to a Sales Order, so it can only go on a DC by itself.`,
      );
    }
    const first = picked[0]!;
    const other = picked.find((r) => r.soKey !== first.soKey);
    if (other) {
      const soName = (r: typeof first): string => r.soCode ?? r.nc.soCodeText ?? '—';
      throw new ConflictError(
        `${other.nc.code} is on SO ${soName(other)}, ${first.nc.code} is on SO ${soName(first)} — ` +
          'one DC can only carry NCs of one Sales Order.',
      );
    }
  }
  // The one SO every NC shares (resolved through the job card when the NC
  // row has none) — the challan header names it.
  const head = picked[0];
  return {
    ncs: picked.map((r) => r.nc),
    soCode: head ? (head.soCode ?? head.nc.soCodeText ?? null) : null,
  };
}

/** SAME VENDOR: the one source vendor every NC with a known source shares
 *  (null when none is known); 409 naming the two NCs when they differ. */
export async function commonSourceVendorId(
  tx: DbTransaction,
  companyId: string,
  picked: readonly LockedNc[],
): Promise<string | null> {
  // SAME VENDOR: WI4 defaults the return vendor from each NC's ACTUAL source
  // (GRN vendor, or the origin op's outsource PO vendor). Every NC whose
  // source vendor is known must name the same one.
  const sources: NcSource[] = [];
  for (const nc of picked) {
    sources.push(
      await resolveNcSource(tx, companyId, {
        grnLineId: nc.grnLineId,
        jcOpId: nc.jcOpId,
        replacementPoId: nc.replacementPoId,
        sourceDeliveryChallanId: nc.sourceDeliveryChallanId,
      }),
    );
  }
  const knownIdx = sources.map((s, i) => (s.sourceVendorId ? i : -1)).filter((i) => i >= 0);
  const firstKnown = knownIdx[0];
  let sourceVendorId: string | null = null;
  if (firstKnown !== undefined) {
    const a = sources[firstKnown]!;
    sourceVendorId = a.sourceVendorId;
    const clash = knownIdx.find((i) => sources[i]!.sourceVendorId !== sourceVendorId);
    if (clash !== undefined) {
      const b = sources[clash]!;
      const vName = (s: typeof a): string => s.sourceVendorCode ?? s.sourceVendorName ?? '—';
      throw new ConflictError(
        `${picked[firstKnown]!.code} came from vendor ${vName(a)}, ${picked[clash]!.code} from ${vName(b)} — ` +
          'one DC can only go to one vendor.',
      );
    }
  }
  return sourceVendorId;
}
