// QC Call Register (ADR-286) — the choices of the Operation filter: every active QC
// Process master name, plus any other name on the job-card calls.

import type { QcRegisterOperationStat } from '@innovic/shared';

/** One grouped row of a job-card feed (key = OP_NAME_KEY). */
export interface OperationCount {
  opKey: string | null;
  spelling: string | null;
  n: number;
}
/** One active master name. */
export interface OperationMaster {
  opKey: string;
  spelling: string;
}

/** One row per key. Name = the master's spelling, else the most-used spelling on
 *  the calls (tie: alphabetical). A name of nothing but spaces is left off. A master
 *  with no calls reads zero. Sorted by name, ignoring capitals. */
export function operationStats(
  pending: readonly OperationCount[],
  done: readonly OperationCount[],
  masters: readonly OperationMaster[],
): QcRegisterOperationStat[] {
  interface Tally {
    master: string | null;
    spellings: Map<string, number>;
    pendingCount: number;
    doneCount: number;
  }
  const byKey = new Map<string, Tally>();
  const tallyOf = (key: string): Tally => {
    let t = byKey.get(key);
    if (t === undefined) {
      t = { master: null, spellings: new Map(), pendingCount: 0, doneCount: 0 };
      byKey.set(key, t);
    }
    return t;
  };
  for (const m of masters) tallyOf(m.opKey).master ??= m.spelling;
  const add = (rows: readonly OperationCount[], field: 'pendingCount' | 'doneCount'): void => {
    for (const r of rows) {
      if (r.opKey === null || r.spelling === null || !/\S/.test(r.spelling)) continue;
      const t = tallyOf(r.opKey);
      t[field] += r.n;
      t.spellings.set(r.spelling, (t.spellings.get(r.spelling) ?? 0) + r.n);
    }
  };
  add(pending, 'pendingCount');
  add(done, 'doneCount');
  const mostUsed = (s: Map<string, number>): string =>
    [...s].sort(([a, an], [b, bn]) => bn - an || a.localeCompare(b))[0]?.[0] ?? '';
  return [...byKey.values()]
    .map((t) => ({
      name: t.master ?? mostUsed(t.spellings),
      pendingCount: t.pendingCount,
      doneCount: t.doneCount,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
