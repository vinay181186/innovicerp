// Multi-Level BOM Excel import (ADR-225 phase 2) — the Preview tree: the file
// as the system reads it, one block per top item, depth-first by sheet order.
//
// A child that is not a BOM Item Code in the file but has a live Default
// Multi-Level BOM is expanded from that BOM through tree.ts's walker
// (loadMlBomTree, read once per BOM at qty 1) — not a second walker. Where
// that live tree reaches an item the file itself defines, the file's rows
// are shown instead (they are what the import leaves behind).
//
// Exploded Qty is for ONE top item: Qty per Set multiplied exactly (scaled
// integers) all the way down and rounded to 3 decimals once, at output.

import {
  type BomLineType,
  ML_BOM_MAX_LEVELS,
  type MlBomImportTreeRow,
  type MlBomTreeResponse,
} from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import type { ExistingDefault, ImportItem } from './import-rows';
import { loadMlBomTree } from './tree';

/** An exact decimal: value = n / 10^scale. */
interface Dec {
  n: bigint;
  scale: number;
}

export function dec(text: string): Dec {
  const t = text.trim();
  const [whole = '0', frac = ''] = t.split('.');
  return { n: BigInt(`${whole || '0'}${frac}`), scale: frac.length };
}

const mul = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, scale: a.scale + b.scale });

/** Round half up to 3 decimals, as text ("12.346"). */
export function fmt3(d: Dec): string {
  let n = d.n;
  if (d.scale > 3) {
    const div = 10n ** BigInt(d.scale - 3);
    const q = n / div;
    n = (n % div) * 2n >= div ? q + 1n : q;
  } else {
    n = n * 10n ** BigInt(3 - d.scale);
  }
  const s = n.toString().padStart(4, '0');
  return `${s.slice(0, -3)}.${s.slice(-3)}`;
}

/** One valid file row, as the tree uses it. */
export interface TreeLine {
  child: ImportItem;
  qty: number;
  bomType: BomLineType;
}

export interface TreeInput {
  /** BOM item id → its valid rows, in sheet order. Map order = sheet order. */
  fileBoms: ReadonlyMap<string, readonly TreeLine[]>;
  itemsById: ReadonlyMap<string, ImportItem>;
  defaults: ReadonlyMap<string, ExistingDefault>;
}

export async function buildImportTree(
  tx: DbTransaction,
  companyId: string,
  input: TreeInput,
): Promise<{ tree: MlBomImportTreeRow[]; levels: number }> {
  const { fileBoms, itemsById, defaults } = input;
  const cache = new Map<string, MlBomTreeResponse>();
  const liveTree = async (bomId: string): Promise<MlBomTreeResponse> => {
    let t = cache.get(bomId);
    if (!t) {
      t = await loadMlBomTree(tx, companyId, bomId, 1);
      cache.set(bomId, t);
    }
    return t;
  };

  const out: MlBomImportTreeRow[] = [];
  let levels = 0;
  let top = '';
  const push = (row: Omit<MlBomImportTreeRow, 'topItemCode'>): void => {
    out.push({ topItemCode: top, ...row });
    levels = Math.max(levels, row.depth);
  };

  const walkFile = async (
    itemId: string,
    depth: number,
    exact: Dec,
    path: ReadonlySet<string>,
  ): Promise<void> => {
    for (const l of fileBoms.get(itemId) ?? []) {
      const d = depth + 1;
      if (d > ML_BOM_MAX_LEVELS) return;
      const qtyText = l.qty.toFixed(3);
      const childExact = mul(exact, dec(qtyText));
      const inFile = fileBoms.has(l.child.id);
      const live = defaults.get(l.child.id);
      const isSub = l.bomType === 'manufacture' && (inFile || !!live);
      push({
        depth: d,
        itemCode: l.child.code,
        itemName: l.child.name,
        uom: l.child.uom,
        bomType: l.bomType,
        qtyPerSet: qtyText,
        explodedQty: fmt3(childExact),
        isSubAssembly: isSub,
      });
      if (!isSub || path.has(l.child.id)) continue;
      const next = new Set(path).add(l.child.id);
      if (inFile) await walkFile(l.child.id, d, childExact, next);
      else if (live) await walkLive(live.id, d, childExact, next);
    }
  };

  const walkLive = async (
    bomId: string,
    depth: number,
    exact: Dec,
    path: ReadonlySet<string>,
  ): Promise<void> => {
    const t = await liveTree(bomId);
    const exactByKey = new Map<string, Dec>();
    const skip: string[] = [];
    for (const n of t.nodes.slice(1)) {
      if (skip.some((k) => n.key.startsWith(`${k}/`))) continue;
      const d = depth + n.depth;
      if (d > ML_BOM_MAX_LEVELS) continue;
      const cut = n.key.lastIndexOf('/');
      const parentExact = cut < 0 ? exact : (exactByKey.get(n.key.slice(0, cut)) ?? exact);
      const nodeExact = mul(parentExact, dec(n.qtyPerSet ?? '0'));
      exactByKey.set(n.key, nodeExact);
      const fileOwned = n.bomType === 'manufacture' && fileBoms.has(n.itemId);
      push({
        depth: d,
        itemCode: n.itemCode ?? '',
        itemName: n.itemName,
        uom: n.uom,
        bomType: n.bomType,
        qtyPerSet: n.qtyPerSet,
        explodedQty: fmt3(nodeExact),
        isSubAssembly: fileOwned || (n.bomType === 'manufacture' && n.mlBomId !== null),
      });
      if (fileOwned || path.has(n.itemId)) {
        // The file's rows replace this live sub-tree (or it would repeat).
        skip.push(n.key);
        if (fileOwned && !path.has(n.itemId)) {
          await walkFile(n.itemId, d, nodeExact, new Set(path).add(n.itemId));
        }
      }
    }
  };

  // Top items: BOM Item Codes not a Manufacture child of another file BOM.
  const childOfFile = new Set<string>();
  for (const lines of fileBoms.values()) {
    for (const l of lines) {
      if (l.bomType === 'manufacture' && fileBoms.has(l.child.id)) childOfFile.add(l.child.id);
    }
  }
  for (const itemId of fileBoms.keys()) {
    if (childOfFile.has(itemId)) continue;
    const item = itemsById.get(itemId);
    top = item?.code ?? '';
    push({
      depth: 0,
      itemCode: top,
      itemName: item?.name ?? null,
      uom: item?.uom ?? null,
      bomType: null,
      qtyPerSet: null,
      explodedQty: '1.000',
      isSubAssembly: false,
    });
    await walkFile(itemId, 0, dec('1'), new Set([itemId]));
  }
  return { tree: out, levels };
}
