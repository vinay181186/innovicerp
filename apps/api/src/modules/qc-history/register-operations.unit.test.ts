import { describe, expect, it } from 'vitest';

import { operationStats } from './register-operations';

const row = (opKey: string | null, spelling: string | null, n: number) => ({ opKey, spelling, n });

describe('operationStats (ADR-286)', () => {
  it('dir and DIR are one choice, in the master spelling', () => {
    const out = operationStats(
      [row('dir', 'dir', 2), row('dir', 'DIR', 1)],
      [row('dir', 'Dir', 5)],
      [{ opKey: 'dir', spelling: 'DIR' }],
    );
    expect(out).toEqual([{ name: 'DIR', pendingCount: 3, doneCount: 5 }]);
  });

  it('a master name with no calls reads zero', () => {
    expect(operationStats([], [], [{ opKey: 'mir', spelling: 'MIR' }])).toEqual([
      { name: 'MIR', pendingCount: 0, doneCount: 0 },
    ]);
  });

  it('a name not on the master keeps its most-used spelling; a tie is alphabetical', () => {
    expect(operationStats([row('qc', 'qc', 1), row('qc', 'QC', 3)], [], [])[0]?.name).toBe('QC');
    expect(operationStats([row('qc', 'qc', 1), row('qc', 'QC', 1)], [], [])[0]?.name).toBe('qc');
  });

  it('counts the two feeds across every spelling', () => {
    const out = operationStats([row('tpi', 'TPI', 2)], [row('tpi', 'tpi', 2)], []);
    expect(out[0]).toMatchObject({ pendingCount: 2, doneCount: 2 });
  });

  it('leaves a blank name off and sorts ignoring capitals', () => {
    const out = operationStats(
      [row('', '', 1), row(null, null, 1), row('zeta', 'zeta', 1), row('alpha', 'Alpha', 1)],
      [],
      [],
    );
    expect(out.map((o) => o.name)).toEqual(['Alpha', 'zeta']);
  });
});
