// Multi-Level BOM Excel import (ADR-225 phase 2) — the whole-file checks: a
// loop, or a tree deeper than ML_BOM_MAX_LEVELS, across the file AND the
// live BOMs it links into.
//
// The graph is the one the save will leave behind (same rule as guards.ts):
//   - a file BOM item's lines are the file's rows (they replace its Default)
//   - any other BOM keeps its live lines
//   - a Manufacture line expands into its child's BOM: the file's, when the
//     child is a BOM Item Code in the file (the save creates / revises that
//     Default and relinks every manufacture line of it), else the live link
//   - a Buy / Outsource line never expands (decision 9)
//   - depth counts every line, the top item being level 0 (assertTreeSound)
//
// The save re-checks with assertTreeSound after its writes, so this is the
// Preview's answer, and the save's first, all-or-nothing, refusal.

import { sql } from 'drizzle-orm';
import { type BomLineType, ML_BOM_MAX_LEVELS } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { loadItemsByIds } from './helpers';
import type { ExistingDefault } from './import-rows';

export interface GraphLine {
  childItemId: string;
  bomType: BomLineType;
}

interface ExistingBom {
  itemId: string;
  lines: Array<{ childItemId: string; bomType: string; link: string | null }>;
}

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** Live BOMs reachable from the file through live links, one query per level. */
async function loadReachableBoms(
  tx: DbTransaction,
  companyId: string,
  fileBoms: ReadonlyMap<string, readonly GraphLine[]>,
  defaults: ReadonlyMap<string, ExistingDefault>,
): Promise<Map<string, ExistingBom>> {
  const out = new Map<string, ExistingBom>();
  let frontier = new Set<string>();
  for (const lines of fileBoms.values()) {
    for (const l of lines) {
      const d = defaults.get(l.childItemId);
      if (l.bomType === 'manufacture' && !fileBoms.has(l.childItemId) && d) frontier.add(d.id);
    }
  }
  for (let round = 0; round <= ML_BOM_MAX_LEVELS && frontier.size > 0; round++) {
    const rows = (await tx.execute(sql`
      SELECT b.id AS bom_id, b.item_id, l.child_item_id, l.bom_type, l.child_ml_bom_id
      FROM public.ml_boms b
      LEFT JOIN public.ml_bom_lines l ON l.ml_bom_id = b.id AND l.deleted_at IS NULL
      WHERE b.company_id = ${companyId}::uuid
        AND b.deleted_at IS NULL
        AND b.id IN (${uuidList([...frontier])})
      ORDER BY b.id, l.line_no
    `)) as unknown as Array<{
      bom_id: string;
      item_id: string;
      child_item_id: string | null;
      bom_type: string | null;
      child_ml_bom_id: string | null;
    }>;
    const next = new Set<string>();
    for (const r of rows) {
      let b = out.get(r.bom_id);
      if (!b) {
        b = { itemId: r.item_id, lines: [] };
        out.set(r.bom_id, b);
      }
      if (!r.child_item_id || !r.bom_type) continue;
      b.lines.push({ childItemId: r.child_item_id, bomType: r.bom_type, link: r.child_ml_bom_id });
      if (
        r.bom_type === 'manufacture' &&
        !fileBoms.has(r.child_item_id) &&
        r.child_ml_bom_id &&
        !out.has(r.child_ml_bom_id)
      ) {
        next.add(r.child_ml_bom_id);
      }
    }
    for (const id of out.keys()) next.delete(id);
    frontier = next;
  }
  return out;
}

/**
 * The file errors: every distinct loop ("Loop: A → B → A", item codes), every
 * top item deeper than ML_BOM_MAX_LEVELS, and every live BOM above a file
 * item that the file would push past ML_BOM_MAX_LEVELS.
 */
export async function checkFileGraph(
  tx: DbTransaction,
  companyId: string,
  fileBoms: ReadonlyMap<string, readonly GraphLine[]>,
  defaults: ReadonlyMap<string, ExistingDefault>,
  codeOf: ReadonlyMap<string, string>,
): Promise<string[]> {
  const existing = await loadReachableBoms(tx, companyId, fileBoms, defaults);

  const itemOf = (key: string): string =>
    key.startsWith('f:') ? key.slice(2) : (existing.get(key.slice(2))?.itemId ?? '');
  const linesOf = (key: string): Array<{ next: string | null }> => {
    if (key.startsWith('f:')) {
      return (fileBoms.get(key.slice(2)) ?? []).map((l) => {
        if (l.bomType !== 'manufacture') return { next: null };
        if (fileBoms.has(l.childItemId)) return { next: `f:${l.childItemId}` };
        const d = defaults.get(l.childItemId);
        return { next: d && existing.has(d.id) ? `b:${d.id}` : null };
      });
    }
    return (existing.get(key.slice(2))?.lines ?? []).map((l) => {
      if (l.bomType !== 'manufacture') return { next: null };
      if (fileBoms.has(l.childItemId)) return { next: `f:${l.childItemId}` };
      return { next: l.link && existing.has(l.link) ? `b:${l.link}` : null };
    });
  };

  // ── Down: one depth-first walk; a grey node met again is a loop ─────────
  const state = new Map<string, 1 | 2>();
  const height = new Map<string, number>();
  const stack: string[] = [];
  const loops: string[][] = [];
  const loopSeen = new Set<string>();
  const dfs = (key: string): number => {
    const done = height.get(key);
    if (state.get(key) === 2 && done !== undefined) return done;
    state.set(key, 1);
    stack.push(key);
    let h = 0;
    for (const l of linesOf(key)) {
      let below = 0;
      if (l.next && state.get(l.next) === 1) {
        const cycle = stack.slice(stack.indexOf(l.next));
        const sig = [...cycle].sort().join('|');
        if (!loopSeen.has(sig)) {
          loopSeen.add(sig);
          loops.push([...cycle.map(itemOf), itemOf(l.next)]);
        }
      } else if (l.next) {
        below = dfs(l.next);
      }
      h = Math.max(h, 1 + below);
    }
    stack.pop();
    state.set(key, 2);
    height.set(key, h);
    return h;
  };
  for (const itemId of fileBoms.keys()) dfs(`f:${itemId}`);

  const missing = new Set<string>();
  for (const loop of loops) for (const id of loop) if (!codeOf.has(id)) missing.add(id);
  const extraCodes = await loadItemsByIds(tx, [...missing], companyId);
  const code = (id: string): string => codeOf.get(id) ?? extraCodes.get(id)?.code ?? id.slice(0, 8);

  const errors = loops.map(
    (loop) =>
      `Loop: ${loop.map(code).join(' → ')}. A part cannot be inside its own sub-assembly — ` +
      `change the line type to Buy / Outsource, or remove the line.`,
  );
  if (loops.length > 0) return errors;

  const childOfFile = new Set<string>();
  for (const lines of fileBoms.values()) {
    for (const l of lines) {
      if (l.bomType === 'manufacture' && fileBoms.has(l.childItemId))
        childOfFile.add(l.childItemId);
    }
  }
  for (const itemId of fileBoms.keys()) {
    const h = height.get(`f:${itemId}`) ?? 0;
    if (!childOfFile.has(itemId) && h > ML_BOM_MAX_LEVELS) {
      errors.push(
        `${code(itemId)} would be ${h} levels deep. A Multi-Level BOM can nest at most ` +
          `${ML_BOM_MAX_LEVELS} levels.`,
      );
    }
  }

  // ── Up: live BOMs that use a file item, however far up ──────────────────
  const itemHeight = new Map<string, number>();
  for (const itemId of fileBoms.keys()) itemHeight.set(itemId, height.get(`f:${itemId}`) ?? 0);
  const bestUp = new Map<string, number>();
  const tooDeep: Array<{ parentCode: string; childItemId: string; h: number }> = [];
  let frontier = new Set(fileBoms.keys());
  for (let round = 0; round <= ML_BOM_MAX_LEVELS && frontier.size > 0; round++) {
    const rows = (await tx.execute(sql`
      SELECT l.ml_bom_id, p.code, p.item_id, p.is_default, l.child_item_id
      FROM public.ml_bom_lines l
      JOIN public.ml_boms p ON p.id = l.ml_bom_id
      WHERE l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND l.bom_type = 'manufacture'
        AND l.child_item_id IN (${uuidList([...frontier])})
        AND p.company_id = ${companyId}::uuid
        AND p.deleted_at IS NULL
    `)) as unknown as Array<{
      ml_bom_id: string;
      code: string;
      item_id: string;
      is_default: boolean;
      child_item_id: string;
    }>;
    const next = new Set<string>();
    for (const r of rows) {
      // A file item's Default is replaced by the file's rows — counted above.
      if (r.is_default && fileBoms.has(r.item_id)) continue;
      const h = 1 + (itemHeight.get(r.child_item_id) ?? 0);
      if (h <= (bestUp.get(r.ml_bom_id) ?? -1)) continue;
      bestUp.set(r.ml_bom_id, h);
      if (h > ML_BOM_MAX_LEVELS) {
        tooDeep.push({ parentCode: r.code, childItemId: r.child_item_id, h });
        continue;
      }
      // Only a Default is linked by anything above it.
      if (r.is_default && !fileBoms.has(r.item_id) && h > (itemHeight.get(r.item_id) ?? -1)) {
        itemHeight.set(r.item_id, h);
        next.add(r.item_id);
      }
    }
    frontier = next;
  }
  if (tooDeep.length > 0) {
    const need = tooDeep.map((t) => t.childItemId).filter((id) => !codeOf.has(id));
    const more = await loadItemsByIds(tx, need, companyId);
    const seen = new Set<string>();
    for (const t of tooDeep) {
      if (seen.has(t.parentCode)) continue;
      seen.add(t.parentCode);
      const child = codeOf.get(t.childItemId) ?? more.get(t.childItemId)?.code ?? 'an item';
      errors.push(
        `${t.parentCode} uses ${child} as a sub-assembly and would become ${t.h} levels deep. ` +
          `A Multi-Level BOM can nest at most ${ML_BOM_MAX_LEVELS} levels.`,
      );
    }
  }
  return errors;
}
