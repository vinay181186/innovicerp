// Multi-Level Plan (ADR-225 phase 3) — the figures, as a PURE function.
//
// The rules are the contract header (packages/shared/src/schemas/ml-plan.ts):
//   top row       Gross = Net = Plan Qty, From Stock = On PO / PR = 0
//   any other row Gross      = parent's Net Need × Qty per Set
//                 From Stock = min(Gross, free stock left for the item)
//                 On PO / PR = min(Gross − From Stock, open PO + PR qty left
//                              for the item) on a Buy / Outsource row; 0 on a
//                              Manufacture row
//                 Net Need   = max(0, Gross − From Stock − On PO / PR), rounded
//                              UP to a whole piece for a whole-number UOM
// One pool per item, drawn down in tree order (depth-first by BOM line no.),
// so the same item on two rows is never given the same stock twice. A
// sub-assembly's children are worked from ITS Net Need.
//
// Arithmetic is done in integer THOUSANDTHS (BigInt) — every stored figure is
// numeric(14,3) — so there is no float drift (0.1 + 0.2) and no overflow. The
// Gross product (≤ 3 dp × ≤ 3 dp) is exact to 6 dp and rounded half-up to
// 3 dp once; everything after that is exact.

import { isWholeNumberUom } from '@innovic/shared';
import type { BomLineType } from '@innovic/shared';

/** One row of the tree to be worked out. Parents come before their children
 *  (depth-first order); the top row is the one with depth 0. */
export interface WalkNode {
  /** Unique within the walk. */
  key: string;
  /** null on the top row. */
  parentKey: string | null;
  depth: number;
  itemId: string;
  uom: string | null;
  bomType: BomLineType | null;
  isSubAssembly: boolean;
  mlBomId: string | null;
  mlBomRevision: number | null;
  /** numeric text, null on the top row. */
  qtyPerSet: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeText: string | null;
}

export interface ComputedNode extends WalkNode {
  seq: number;
  grossNeedQty: string;
  fromStockQty: string;
  onPoPrQty: string;
  netNeedQty: string;
}

/** Item id → quantity (numeric text or number). Missing item = 0. */
export type QtyPool = ReadonlyMap<string, string | number>;

const THOUSAND = 1000n;

/** "12.5" / 12.5 / "-3" → thousandths, rounded half-up past 3 decimals. */
export function toMilli(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return 0n;
  const s = typeof v === 'number' ? v.toFixed(6) : String(v).trim();
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m) return 0n;
  const neg = m[1] === '-';
  const int = BigInt(m[2] || '0');
  const frac = (m[3] ?? '').padEnd(4, '0');
  let milli = int * THOUSAND + BigInt(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) milli += 1n;
  return neg ? -milli : milli;
}

/** thousandths → "12.500" */
export function milliToText(m: bigint): string {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const int = a / THOUSAND;
  const frac = (a % THOUSAND).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${int.toString()}.${frac}`;
}

const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const maxB = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** a × b where both are thousandths → thousandths, half-up. Non-negative in. */
function mulMilli(a: bigint, b: bigint): bigint {
  return (a * b + THOUSAND / 2n) / THOUSAND;
}

/** Round thousandths UP to a whole unit. */
function ceilWhole(m: bigint): bigint {
  return ((m + THOUSAND - 1n) / THOUSAND) * THOUSAND;
}

/**
 * Work the figures out for every row of `nodes` (depth-first, top first).
 * `stock` = free stock per item; `onPoPr` = open PO + open PR qty per item.
 * Neither map is changed; the pools are drawn down on a private copy.
 */
export function computePlanFigures(
  nodes: readonly WalkNode[],
  planQty: number,
  stock: QtyPool,
  onPoPr: QtyPool,
): ComputedNode[] {
  const stockLeft = new Map<string, bigint>();
  for (const [k, v] of stock) stockLeft.set(k, maxB(0n, toMilli(v)));
  const orderLeft = new Map<string, bigint>();
  for (const [k, v] of onPoPr) orderLeft.set(k, maxB(0n, toMilli(v)));

  const netByKey = new Map<string, bigint>();
  const out: ComputedNode[] = [];
  const planMilli = BigInt(planQty) * THOUSAND;

  nodes.forEach((n, seq) => {
    if (n.depth === 0 || n.parentKey === null) {
      netByKey.set(n.key, planMilli);
      out.push({
        ...n,
        seq,
        grossNeedQty: milliToText(planMilli),
        fromStockQty: milliToText(0n),
        onPoPrQty: milliToText(0n),
        netNeedQty: milliToText(planMilli),
      });
      return;
    }
    const parentNet = netByKey.get(n.parentKey);
    if (parentNet === undefined) {
      // Depth-first order guarantees the parent came first; a row whose
      // parent is missing is a broken walk, never a figure to guess.
      throw new Error(`ml-plan snapshot: parent ${n.parentKey} of ${n.key} not seen first`);
    }
    const gross = mulMilli(parentNet, toMilli(n.qtyPerSet));

    const freeStock = stockLeft.get(n.itemId) ?? 0n;
    const fromStock = minB(gross, freeStock);
    stockLeft.set(n.itemId, freeStock - fromStock);

    let onPoPrQty = 0n;
    if (n.bomType === 'purchase' || n.bomType === 'outsource') {
      const coming = orderLeft.get(n.itemId) ?? 0n;
      onPoPrQty = minB(gross - fromStock, coming);
      orderLeft.set(n.itemId, coming - onPoPrQty);
    }

    let net = maxB(0n, gross - fromStock - onPoPrQty);
    if (isWholeNumberUom(n.uom)) net = ceilWhole(net);
    netByKey.set(n.key, net);

    out.push({
      ...n,
      seq,
      grossNeedQty: milliToText(gross),
      fromStockQty: milliToText(fromStock),
      onPoPrQty: milliToText(onPoPrQty),
      netNeedQty: milliToText(net),
    });
  });
  return out;
}
