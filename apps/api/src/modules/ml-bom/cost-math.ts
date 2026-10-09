// Multi-Level BOM cost estimate — the roll-up maths (ADR-225 phase 6). Pure:
// no database, so the rules below are unit-tested on their own
// (cost-math.test.ts). cost.ts reads the tree + rates and calls this.
//
// Every figure is an exact fraction (BigInt numerator / denominator) from the
// numeric text Postgres returns — the only division, minutes / 60, stays
// exact — and is rounded to 2 decimals ONCE, when a row is written out. So a
// sub-assembly rolls up its children's exact costs, not their rounded ones.
//
//   Buy row              unitCost = materialRate = bought rate (GRN, else
//                        PO); none → null, counted in noRateCount, adds 0.
//   Outsource row        the same rate, but it is a processing charge: it is
//                        the row's operationRate (and operationCost), not
//                        material; materialRate null.
//   Manufacture leaf     materialRate = RM item's bought rate × RM Qty per
//                        Piece (Route Card); unitCost = material + operations.
//                        No card / no RM item / no RM qty / no rate → material
//                        null, counted, adds 0.
//   Row with children    unitCost = Σ child unitCost × child Qty per Set + own
//   (sub-assembly, top)  operations; rateSource 'roll_up', materialRate null.
//   Operations           = Σ op Cycle Time (min) × machine Hour Rate / 60, on
//                        every Manufacture row (and the top); 0 otherwise.
//                        An OSP step adds 0 (a Route Card step carries no OSP
//                        rate) and so does an in-house step with no machine /
//                        a machine in Trash / Hour Rate 0 — either one counts
//                        the ROW in noRateCount (once, whatever else is
//                        missing on it), so the total is a floor.
//   amount               = unitCost × the row's exact Exploded Qty.
//   totalCost            = top amount; materialCost / operationCost split it
//                        (operationCost = totalCost − materialCost, so the two
//                        always add up to the total shown).

import type { MlBomCostResponse, MlBomCostRow, MlBomRateSource } from '@innovic/shared';
import type { MlBomTreeNode } from './schema';

// ─── Exact fractions ────────────────────────────────────────────────────

export interface Frac {
  n: bigint;
  d: bigint;
}

const ZERO: Frac = { n: 0n, d: 1n };

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
};

const norm = (n: bigint, d: bigint): Frac => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};

/** "12.345", "-0.5", "1e-7", "3.2E+4" → exact fraction. Throws on junk. */
export function parseDecimal(text: string): Frac {
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Not a number: ${text}`);
  const frac = m[3] ?? '';
  let n = BigInt((m[2] || '0') + frac);
  let d = 10n ** BigInt(frac.length);
  const exp = Number(m[4] ?? 0);
  if (exp > 0) n *= 10n ** BigInt(exp);
  else if (exp < 0) d *= 10n ** BigInt(-exp);
  if (m[1] === '-') n = -n;
  return norm(n, d);
}

export const add = (a: Frac, b: Frac): Frac => norm(a.n * b.d + b.n * a.d, a.d * b.d);
export const mul = (a: Frac, b: Frac): Frac => norm(a.n * b.n, a.d * b.d);
const divInt = (a: Frac, k: bigint): Frac => norm(a.n, a.d * k);
const isZero = (a: Frac): boolean => a.n === 0n;

/** Round half away from zero to 2 decimals → "1234.50". */
export function money(a: Frac): string {
  const neg = a.n < 0n;
  const n = neg ? -a.n : a.n;
  const scaled = n * 100n;
  let q = scaled / a.d;
  if ((scaled % a.d) * 2n >= a.d) q += 1n;
  const s = q.toString().padStart(3, '0');
  const out = `${s.slice(0, -2)}.${s.slice(-2)}`;
  return neg && q !== 0n ? `-${out}` : out;
}

// ─── Inputs ─────────────────────────────────────────────────────────────

export interface ItemRate {
  /** numeric text */
  rate: string;
  source: 'grn' | 'po';
  /** GRN code (source grn) or PO code (source po). */
  ref: string | null;
}

export interface RouteCardCost {
  rawMaterialItemId: string | null;
  /** numeric text, null when the card has none */
  rmQtyPerPiece: string | null;
  /** Σ cycle_time_min × machine hour_rate (numeric text) — NOT yet / 60. */
  opMinuteRate: string;
  /** Some step had no rate (OSP step, or no machine / Hour Rate 0). */
  opRateMissing: boolean;
}

export interface CostInputs {
  qty: number;
  /** loadMlBomTree's nodes — top row first (key ''), then depth-first. */
  nodes: MlBomTreeNode[];
  routeCards: ReadonlyMap<string, RouteCardCost>;
  rates: ReadonlyMap<string, ItemRate>;
}

// ─── Roll-up ────────────────────────────────────────────────────────────

interface Calc {
  unit: Frac | null;
  /** material share of one unit (exact) */
  mat: Frac;
  /** operations share of one unit (exact) */
  op: Frac;
  ownOp: Frac;
  materialRate: Frac | null;
  source: MlBomRateSource;
  ref: string | null;
  noRate: boolean;
}

const parentKeyOf = (key: string): string | null => {
  if (key === '') return null;
  const i = key.lastIndexOf('/');
  return i < 0 ? '' : key.slice(0, i);
};

export function computeMlBomCost(input: CostInputs): MlBomCostResponse {
  const { nodes, routeCards, rates } = input;
  const children = new Map<string, MlBomTreeNode[]>();
  for (const n of nodes) {
    const p = parentKeyOf(n.key);
    if (p === null) continue;
    const list = children.get(p);
    if (list) list.push(n);
    else children.set(p, [n]);
  }

  // Exact exploded qty, top-down (nodes are depth-first: a parent precedes
  // its children).
  const exact = new Map<string, Frac>();
  for (const n of nodes) {
    const p = parentKeyOf(n.key);
    if (p === null) exact.set(n.key, parseDecimal(String(input.qty)));
    else exact.set(n.key, mul(exact.get(p) ?? ZERO, parseDecimal(n.qtyPerSet ?? '0')));
  }

  const calc = new Map<string, Calc>();
  const ownOpOf = (n: MlBomTreeNode): Frac => {
    if (n.bomType !== null && n.bomType !== 'manufacture') return ZERO;
    const rc = routeCards.get(n.itemId);
    return rc ? divInt(parseDecimal(rc.opMinuteRate), 60n) : ZERO;
  };
  const opMissingOf = (n: MlBomTreeNode): boolean =>
    (n.bomType === null || n.bomType === 'manufacture') &&
    (routeCards.get(n.itemId)?.opRateMissing ?? false);

  // Bottom-up: deepest first, so every child is done before its parent.
  const order = [...nodes].sort((a, b) => Number(b.depth) - Number(a.depth));
  for (const n of order) {
    const kids = children.get(n.key) ?? [];
    const bought = n.bomType === 'purchase' || n.bomType === 'outsource';
    if (bought) {
      const r = rates.get(n.itemId);
      const rate = r ? parseDecimal(r.rate) : null;
      // Outsource = a vendor's processing charge → operations, not material.
      const isOsp = n.bomType === 'outsource';
      calc.set(n.key, {
        unit: rate,
        mat: isOsp ? ZERO : (rate ?? ZERO),
        op: isOsp ? (rate ?? ZERO) : ZERO,
        ownOp: isOsp ? (rate ?? ZERO) : ZERO,
        materialRate: isOsp ? null : rate,
        source: r ? r.source : 'none',
        ref: r?.ref ?? null,
        noRate: !r,
      });
      continue;
    }
    const ownOp = ownOpOf(n);
    if (kids.length > 0) {
      let unit = ownOp;
      let mat = ZERO;
      let op = ownOp;
      for (const k of kids) {
        const c = calc.get(k.key);
        if (!c) continue;
        const q = parseDecimal(k.qtyPerSet ?? '0');
        unit = add(unit, mul(c.unit ?? ZERO, q));
        mat = add(mat, mul(c.mat, q));
        op = add(op, mul(c.op, q));
      }
      calc.set(n.key, {
        unit,
        mat,
        op,
        ownOp,
        materialRate: null,
        source: 'roll_up',
        ref: null,
        noRate: opMissingOf(n),
      });
      continue;
    }
    // Manufacture leaf: Route Card raw material × its bought rate.
    const rc = routeCards.get(n.itemId);
    const rmRate = rc?.rawMaterialItemId ? rates.get(rc.rawMaterialItemId) : undefined;
    const material =
      rc?.rmQtyPerPiece && rmRate
        ? mul(parseDecimal(rmRate.rate), parseDecimal(rc.rmQtyPerPiece))
        : null;
    calc.set(n.key, {
      unit: material ? add(material, ownOp) : isZero(ownOp) ? null : ownOp,
      mat: material ?? ZERO,
      op: ownOp,
      ownOp,
      materialRate: material,
      source: material ? 'route_card' : 'none',
      ref: material ? (rmRate?.ref ?? null) : null,
      noRate: !material || opMissingOf(n),
    });
  }

  let noRateCount = 0;
  const rows: MlBomCostRow[] = nodes.map((n) => {
    const c = calc.get(n.key) as Calc;
    if (c.noRate) noRateCount += 1;
    const q = exact.get(n.key) ?? ZERO;
    return {
      key: n.key,
      depth: Number(n.depth),
      itemId: n.itemId,
      itemCode: n.itemCode,
      itemName: n.itemName,
      uom: n.uom,
      bomType: n.bomType,
      explodedQty: n.explodedQty,
      materialRate: c.materialRate ? money(c.materialRate) : null,
      operationRate: money(c.ownOp),
      unitCost: c.unit ? money(c.unit) : null,
      amount: money(mul(c.unit ?? ZERO, q)),
      rateSource: c.source,
      rateRef: c.ref,
    };
  });

  const top = nodes[0];
  const topCalc = top ? calc.get(top.key) : undefined;
  const topQty = top ? (exact.get(top.key) ?? ZERO) : ZERO;
  const totalCost = money(mul(topCalc?.unit ?? ZERO, topQty));
  const materialCost = money(mul(topCalc?.mat ?? ZERO, topQty));
  const operationCost = money(
    add(parseDecimal(totalCost), mul(parseDecimal(materialCost), { n: -1n, d: 1n })),
  );

  return {
    qty: input.qty,
    rows,
    totalCost,
    materialCost,
    operationCost,
    noRateCount,
    currency: 'INR',
  };
}
