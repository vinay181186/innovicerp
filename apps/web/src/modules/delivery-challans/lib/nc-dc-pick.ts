// Several NCs on ONE return-to-vendor DC (owner 2026-11-01). The rule that
// decides which NCs may be ticked together on +New DC → Against NC and
// Against JW PO / DC: the same Sales Order and the same vendor. Different JW
// POs / job cards inside that one SO are allowed — each DC line shows its own.
// The server checks the same rule on save (POST /nc-register/create-dc); this
// only stops the user ticking a set the server would refuse.

import type { NcRegister, RtvCandidate } from '@innovic/shared';
import { MAX_NCS_PER_DC, RTV_CANDIDATE_STATE_LABELS } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';

/** One NC as both pickers and the DC form show it. */
export interface PickNc {
  ncId: string;
  ncCode: string;
  soId: string | null;
  /** SO No. (with the Internal SO No. when there is one), or null. */
  soLabel: string | null;
  vendorId: string | null;
  vendorCode: string | null;
  vendorName: string | null;
  /** The JW PO the deviated pieces were made under (NC `poCode`). */
  poCode: string | null;
  /** The outward challan the pieces first went out on. */
  sourceDcCode: string | null;
  clientPoLineNo: string | null;
  itemCodeLabel: string;
  itemName: string;
  /** NC rejectedQty — what the DC line carries. */
  qtyToReturn: string;
  /** False = shown greyed, never tickable (QC has not decided yet). */
  ready: boolean;
  /** Why a not-ready row cannot be ticked. */
  notReadyReason: string | null;
}

function soLabelOf(code: string | null, internal: string | null): string | null {
  return code ? soNoWithInternal(code, internal) : null;
}

/** An eligible NC row (GET /nc-register?pendingRtvChallan=true). */
export function pickFromNc(n: NcRegister): PickNc {
  return {
    ncId: n.id,
    ncCode: n.code,
    soId: n.soId ?? null,
    soLabel: soLabelOf(n.soCodeText, n.soInternalNo ?? null),
    vendorId: n.sourceVendorId ?? null,
    vendorCode: n.sourceVendorCode ?? null,
    vendorName: n.sourceVendorName ?? null,
    poCode: n.poCode ?? null,
    sourceDcCode: n.sourceDeliveryChallanCode ?? null,
    clientPoLineNo: n.clientPoLineNo ?? null,
    itemCodeLabel: itemCodeWithRev(n.itemCode ?? n.itemCodeText, n.itemRevision),
    itemName: n.itemName ?? n.itemNameText ?? '—',
    qtyToReturn: n.rejectedQty,
    ready: true,
    notReadyReason: null,
  };
}

/** A JW PO / DC candidate. Its SO comes from the candidate itself (same key
 *  the save groups by); the NC's eligible row (`nc`), when loaded, only adds
 *  the Internal SO No. to the label. */
export function pickFromCandidate(c: RtvCandidate, nc: NcRegister | undefined): PickNc {
  const ready = c.state === 'ready';
  return {
    ncId: c.ncId,
    ncCode: c.ncCode,
    soId: c.soId ?? nc?.soId ?? null,
    soLabel: nc ? soLabelOf(nc.soCodeText, nc.soInternalNo ?? null) : c.soCodeText,
    vendorId: c.vendorId,
    vendorCode: c.vendorCode,
    vendorName: c.vendorName,
    poCode: c.poCode,
    sourceDcCode: c.sourceDeliveryChallanCode,
    clientPoLineNo: c.clientPoLineNo,
    itemCodeLabel: itemCodeWithRev(c.itemCode ?? c.itemCodeText, c.itemRevision),
    itemName: c.itemName ?? c.itemNameText ?? '—',
    qtyToReturn: c.rejectedQty,
    ready,
    notReadyReason: ready ? null : RTV_CANDIDATE_STATE_LABELS[c.state],
  };
}

/** Why `row` cannot be ticked next to what is already ticked — null = it can.
 *  A ticked row can always be unticked. */
export function pickBlockReason(row: PickNc, picked: readonly PickNc[]): string | null {
  if (!row.ready) return row.notReadyReason;
  if (picked.some((p) => p.ncId === row.ncId)) return null;
  const first = picked[0];
  if (first === undefined) return null;
  if (picked.length >= MAX_NCS_PER_DC) return `At most ${MAX_NCS_PER_DC} NCs go on one DC`;
  if (first.soId === null) return 'The ticked NC has no SO, so it goes on a DC alone';
  if (row.soId === null) return 'No SO — this NC goes on a DC alone';
  if (row.soId !== first.soId) return `Other SO${row.soLabel ? ` (${row.soLabel})` : ''}`;
  const vendorId = picked.find((p) => p.vendorId !== null)?.vendorId ?? null;
  if (vendorId !== null && row.vendorId !== null && row.vendorId !== vendorId) {
    return `Other vendor${row.vendorName ? ` (${row.vendorName})` : ''}`;
  }
  return null;
}

/** The ids a handed-over set may be pre-ticked with: ALL of them when every one
 *  is loaded, ready and fits the same-SO + same-vendor rule, else none. */
export function pretickable(ids: readonly string[], rows: readonly PickNc[]): string[] {
  if (ids.length === 0) return [];
  const byId = new Map(rows.map((r) => [r.ncId, r]));
  const picked: PickNc[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || pickBlockReason(row, picked) !== null) return [];
    if (!picked.some((p) => p.ncId === id)) picked.push(row);
  }
  return picked.map((p) => p.ncId);
}
