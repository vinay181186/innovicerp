// The Job Card operation-edit vocabulary (ADR-220) — the two helpers that decide
// WHICH operation is the system's own "Final Inspection" and take it out of a
// routing. ADR-227: discovered by POSITION in the STORED routing (terminalQcOp),
// then removed by IDENTITY everywhere else (withoutOpId).
//
// The positional remover survives for exactly ONE case, fenced off and named
// accordingly: a frozen approval payload staged before the id was carried, whose
// `op:add:<index>` keys were BUILT positionally and must be read back the same
// way (withoutTrailingGeneratedTerminalQcLegacyKeys, reached only through
// proposedOpsForStagedKeys). Nothing else may use it.
//
// Pure functions, no database.

import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../lib/errors';
import {
  JC_OP_ADD_UNRESOLVED_MESSAGE,
  proposedOpsForStagedKeys,
  stagedTerminalQcOpId,
  terminalQcOp,
  withApprovedOpAdds,
  withoutOpId,
  withoutTrailingGeneratedTerminalQcLegacyKeys,
  withStagedTerminalQcOpId,
} from './jc-op-edit';

const op = (id: string | null, opType: string, operation: string) => ({ id, opType, operation });
const FI = (id: string | null) => op(id, 'qc', 'Final Inspection');

describe('terminalQcOp — finding the generated Final Inspection in a STORED routing', () => {
  it('finds it when it is the last op', () => {
    const ops = [op('a', 'process', 'Turning'), FI('z')];
    expect(terminalQcOp(ops)?.id).toBe('z');
  });

  it('does not treat a mid-route Final Inspection as the generated one', () => {
    // Someone deliberately put an inspection in the middle; it is an ordinary
    // operation and keeps its own approval boxes.
    const ops = [FI('m'), op('a', 'process', 'Turning')];
    expect(terminalQcOp(ops)).toBeUndefined();
  });

  it('picks the LAST one when two ops are both named Final Inspection', () => {
    // Only the terminal one is the system's. The other is the person's own.
    const ops = [op('a', 'process', 'Turning'), FI('m'), op('b', 'process', 'Milling'), FI('z')];
    expect(terminalQcOp(ops)?.id).toBe('z');
  });

  it('returns nothing for a routing that does not end in Final Inspection', () => {
    expect(terminalQcOp([op('a', 'process', 'Turning')])).toBeUndefined();
    expect(terminalQcOp([op('a', 'qc', 'MIR')])).toBeUndefined();
    expect(terminalQcOp([op('a', 'outsource', 'Plating')])).toBeUndefined();
    expect(terminalQcOp([])).toBeUndefined();
  });
});

describe('withoutOpId — the IDENTITY form (ADR-227)', () => {
  it('removes the op with that id wherever it sits', () => {
    const posted = [op('a', 'process', 'Turning'), FI('z'), op(null, 'process', 'Deburring')];
    expect(withoutOpId(posted, 'z').map((o) => o.operation)).toEqual(['Turning', 'Deburring']);
  });

  it('removes it from the last position too (stored routing)', () => {
    const stored = [op('a', 'process', 'Turning'), FI('z')];
    expect(withoutOpId(stored, 'z').map((o) => o.id)).toEqual(['a']);
  });

  it('returns the list unchanged for a null / undefined id', () => {
    const ops = [op('a', 'process', 'Turning'), FI('z')];
    expect(withoutOpId(ops, null)).toEqual(ops);
    expect(withoutOpId(ops, undefined)).toEqual(ops);
  });

  it('leaves an id that is not in the list alone', () => {
    const ops = [op('a', 'process', 'Turning')];
    expect(withoutOpId(ops, 'nope')).toEqual(ops);
  });

  it('takes out ONLY the stored terminal op when two ops are named Final Inspection', () => {
    const posted = [FI('m'), op('a', 'process', 'Turning'), FI('z')];
    expect(withoutOpId(posted, 'z').map((o) => o.id)).toEqual(['m', 'a']);
  });

  it('never mutates the list it was given', () => {
    const ops = [op('a', 'process', 'Turning'), FI('z')];
    withoutOpId(ops, 'z');
    expect(ops).toHaveLength(2);
  });

  it('keeps a newly added op (no id yet) — nothing to match on', () => {
    const posted = [op(null, 'process', 'Turning'), op(null, 'qc', 'Final Inspection')];
    expect(withoutOpId(posted, null)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (sixth review round) — AN APPROVED ADDITION MUST NOT VANISH.
//
// `op:add:<index>` is an index into the FROZEN proposed routing with the
// generated Final Inspection stripped out. The approval used to re-derive WHICH
// op that is from the stored routing at approval time — a different question
// from "which op does this payload carry?". The two part company when that row
// is replaced between staging and approval (the ADR-081 in-house / outsource
// switch writes jc_ops directly), and the stripped list is then not the list the
// boxes were indexed against: every index past the op that was wrongly stripped
// shifts, the add lands on an op that already has an id, and it used to be
// skipped IN SILENCE — the approval reported success, the operation was never
// added, nothing was logged.
//
// Two things fixed: the id is carried WITH the payload, and an index that does
// not resolve to a new op now THROWS.
describe('stagedTerminalQcOpId / withStagedTerminalQcOpId — carrying the id', () => {
  it('reads back the id that was attached', () => {
    const payload = withStagedTerminalQcOpId({ ops: [op('a', 'process', 'Turning')] }, 'fi');
    expect(stagedTerminalQcOpId(payload)).toBe('fi');
  });

  it('survives the jsonb round-trip the frozen payload makes', () => {
    // proposed_payload is a jsonb column, so the key rides along with no schema
    // change — but only if it survives JSON. null must survive as null (it means
    // "there was no generated Final Inspection"), not collapse to undefined.
    const attached = withStagedTerminalQcOpId({ ops: [], remarks: null }, 'fi');
    expect(stagedTerminalQcOpId(JSON.parse(JSON.stringify(attached)))).toBe('fi');
    const none = withStagedTerminalQcOpId({ ops: [] }, null);
    expect(stagedTerminalQcOpId(JSON.parse(JSON.stringify(none)))).toBeNull();
  });

  it('answers undefined for a payload staged before the id was carried', () => {
    // THE FALLBACK SWITCH: undefined (key absent) is the only state that lets
    // applyEdit go back to re-deriving the id. null must NOT do that — it means
    // the card genuinely had no generated Final Inspection.
    expect(stagedTerminalQcOpId({ ops: [] })).toBeUndefined();
    expect(stagedTerminalQcOpId(undefined)).toBeUndefined();
    expect(stagedTerminalQcOpId({ stagedTerminalQcOpId: null })).toBeNull();
    expect(stagedTerminalQcOpId({ stagedTerminalQcOpId: '' })).toBeNull();
  });

  it('leaves the rest of the payload exactly as it was', () => {
    const input = { ops: [op('a', 'process', 'Turning')], orderQty: 10, remarks: null };
    const out = withStagedTerminalQcOpId(input, 'fi');
    expect(out.ops).toBe(input.ops);
    expect(out.orderQty).toBe(10);
    expect(out.remarks).toBeNull();
  });
});

describe('withApprovedOpAdds — where an approved addition lands', () => {
  /** An op as the routing rebuild holds it: id = already stored, no id = added. */
  const o = (id: string | null, operation: string) => ({
    ...(id ? { id } : {}),
    operation,
  });

  it('inserts the new op right after the proposed op in front of it', () => {
    const kept = [o('c1', 'Cutting'), o('m1', 'Milling')];
    const proposed = [o('c1', 'Cutting'), o(null, 'Deburring'), o('m1', 'Milling')];
    expect(withApprovedOpAdds(kept, proposed, [1]).map((x) => x.operation)).toEqual([
      'Cutting',
      'Deburring',
      'Milling',
    ]);
  });

  it('puts an add at index 0 first', () => {
    const kept = [o('c1', 'Cutting')];
    const proposed = [o(null, 'Facing'), o('c1', 'Cutting')];
    expect(withApprovedOpAdds(kept, proposed, [0]).map((x) => x.operation)).toEqual([
      'Facing',
      'Cutting',
    ]);
  });

  it('keeps two adds in the order the person arranged them', () => {
    const kept = [o('c1', 'Cutting'), o('m1', 'Milling')];
    const proposed = [
      o('c1', 'Cutting'),
      o(null, 'Deburring'),
      o(null, 'Marking'),
      o('m1', 'Milling'),
    ];
    expect(withApprovedOpAdds(kept, proposed, [2, 1]).map((x) => x.operation)).toEqual([
      'Cutting',
      'Deburring',
      'Marking',
      'Milling',
    ]);
  });

  it('falls back to the front when the op in front of it was removed', () => {
    // 'c1' was approved for removal, so it is not in `kept`. The addition still
    // has to go somewhere — the front of the routing.
    const kept = [o('m1', 'Milling')];
    const proposed = [o('c1', 'Cutting'), o(null, 'Deburring'), o('m1', 'Milling')];
    expect(withApprovedOpAdds(kept, proposed, [1]).map((x) => x.operation)).toEqual([
      'Deburring',
      'Milling',
    ]);
  });

  it('THROWS instead of silently skipping when the index lands on a stored op', () => {
    // This is the state that used to lose the operation: the index resolves to an
    // op that already has an id, so there was nothing to add — and the approval
    // still reported success.
    const kept = [o('c1', 'Cutting'), o('m1', 'Milling')];
    const proposed = [o('c1', 'Cutting'), o('m1', 'Milling')];
    expect(() => withApprovedOpAdds(kept, proposed, [1])).toThrow(ConflictError);
    expect(() => withApprovedOpAdds(kept, proposed, [1])).toThrow(JC_OP_ADD_UNRESOLVED_MESSAGE);
  });

  it('THROWS when the index is past the end of the frozen payload', () => {
    const kept = [o('c1', 'Cutting')];
    const proposed = [o('c1', 'Cutting')];
    expect(() => withApprovedOpAdds(kept, proposed, [5])).toThrow(JC_OP_ADD_UNRESOLVED_MESSAGE);
  });

  it('does nothing, and throws nothing, when no addition was approved', () => {
    const kept = [o('c1', 'Cutting')];
    expect(withApprovedOpAdds(kept, [o('c1', 'Cutting')], [])).toEqual(kept);
  });

  it('never mutates the lists it was given', () => {
    const kept = [o('c1', 'Cutting')];
    const proposed = [o('c1', 'Cutting'), o(null, 'Deburring')];
    withApprovedOpAdds(kept, proposed, [1]);
    expect(kept).toHaveLength(1);
    expect(proposed).toHaveLength(2);
  });

  // ADR-227 (eighth round, fix 5) — ONE GUARD DISAGREED WITH ITS THREE SIBLINGS
  // ABOUT WHAT AN ID IS.
  //
  // Four places read "does this proposed op have an id?" out of the same frozen
  // payload: diffFields (`if (p.id) return`), afterSnapshot, the `proposedById`
  // maps (`filter((p) => p.id)`) — all TRUTHY — and this one, which asked
  // `prop.id != null`. An EMPTY-STRING id is falsy but not null, so the three
  // siblings called such a row an ADDITION and built a box for it, while this one
  // called it "already stored" and threw, aborting the whole approval decision.
  // The route's schema makes '' unreachable today, so nothing live diverged; one
  // of four places disagreeing is simply where the next bug would hide.
  it('reads an EMPTY-STRING id the same way its three siblings do: as an addition', () => {
    type Row = { id?: string; operation: string };
    const kept: Row[] = [o('c1', 'Cutting'), o('m1', 'Milling')];
    const proposed: Row[] = [
      o('c1', 'Cutting'),
      { id: '', operation: 'Deburring' }, // an addition, by every sibling's test
      o('m1', 'Milling'),
    ];
    // What the siblings see: two stored ops, so index 1 is the new one.
    expect(proposed.filter((p) => p.id).map((p) => p.id)).toEqual(['c1', 'm1']);
    // ...and this helper now agrees — it inserts it instead of throwing.
    expect(withApprovedOpAdds(kept, proposed, [1]).map((x) => x.operation)).toEqual([
      'Cutting',
      'Deburring',
      'Milling',
    ]);
  });

  it('still throws for a REAL id, which is the case the guard exists for', () => {
    type Row = { id?: string; operation: string };
    const kept: Row[] = [o('c1', 'Cutting'), o('m1', 'Milling')];
    const proposed: Row[] = [o('c1', 'Cutting'), o('m1', 'Milling')];
    expect(() => withApprovedOpAdds(kept, proposed, [1])).toThrow(JC_OP_ADD_UNRESOLVED_MESSAGE);
  });
});

describe('the staged id is what keeps an approved addition findable', () => {
  // THE SHAPE THAT LOSES DATA. Stored at staging: Turning, the PERSON's own
  // "Final Inspection", Milling, then the SYSTEM's Final Inspection ('fi').
  // The boxes are built with 'fi' stripped, so the added 'Deburring' is index 3.
  const frozenPayload = [
    op('a1', 'process', 'Turning'),
    FI('mid'), // the person's own inspection, mid-route
    op('a2', 'process', 'Milling'),
    op(null, 'process', 'Deburring'), // the addition — index 3 once 'fi' is out
    FI('fi'), // the system's own, last
  ];

  it('the box was built as index 3 of the list stripped by the STAGED id', () => {
    expect(withoutOpId(frozenPayload, 'fi')[3]?.operation).toBe('Deburring');
  });

  it('re-deriving the id at approval time can shift the index onto a stored op', () => {
    // Between staging and approval the last two rows are rewritten (ADR-081
    // writes jc_ops directly), so the stored routing now ENDS with the person's
    // own inspection: terminalQcOp answers 'mid'. Stripping the frozen payload by
    // 'mid' takes out an EARLIER op, every index after it slides down by one, and
    // index 3 is now the system's Final Inspection — which has an id, so the
    // approved addition used to be dropped without a word.
    const storedNow = [op('a1', 'process', 'Turning'), FI('mid')];
    expect(terminalQcOp(storedNow)?.id).toBe('mid');
    const misStripped = withoutOpId(frozenPayload, 'mid');
    expect(misStripped[3]?.operation).toBe('Final Inspection');
    expect(misStripped[3]?.id).toBe('fi');
    expect(() => withApprovedOpAdds([op('a1', 'process', 'Turning')], misStripped, [3])).toThrow(
      JC_OP_ADD_UNRESOLVED_MESSAGE,
    );
  });

  it('the staged id still finds the addition after that rewrite', () => {
    const staged = stagedTerminalQcOpId(withStagedTerminalQcOpId({ ops: frozenPayload }, 'fi'));
    const proposed = withoutOpId(frozenPayload, staged);
    const out = withApprovedOpAdds([op('a1', 'process', 'Turning'), FI('mid')], proposed, [3]);
    expect(out.map((x) => x.operation)).toEqual(['Turning', 'Final Inspection', 'Deburring']);
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (SEVENTH review round) — A LEGACY REQUEST MUST BE READ THE WAY IT WAS
// WRITTEN.
//
// `op:add:<index>` is an index into the frozen proposed routing with the
// generated Final Inspection taken out. Requests staged TODAY carry the id that
// was stripped (JC_STAGED_TERMINAL_QC_KEY), so they are read back by id. A
// request staged BEFORE that key existed carries nothing — and its keys were
// built when the strip was POSITIONAL, which counted the Final Inspection
// whenever it was not last in the posted routing (the IN-JC-26-00025 shape: an
// operation added AFTER it).
//
// Read such a payload by a re-derived id and every index past the inspection
// slides down by one: the key resolves to a DIFFERENT element. With an id, that
// throws and rolls the whole approval decision back; with no id, it would add
// the WRONG operation and report success.
//
// Bounded risk, not a live incident: there are zero pending edit requests on
// either database and no JobCard op row was ever staged. The code must still be
// right.
describe('withoutTrailingGeneratedTerminalQcLegacyKeys — the fenced-off positional strip', () => {
  it('drops the LAST op when it is the generated Final Inspection', () => {
    const ops = [op('a1', 'process', 'Turning'), FI('fi')];
    expect(withoutTrailingGeneratedTerminalQcLegacyKeys(ops).map((o) => o.id)).toEqual(['a1']);
  });

  it('drops it by POSITION, with no id needed — that is the whole point', () => {
    const ops = [op('a1', 'process', 'Turning'), FI(null)];
    expect(withoutTrailingGeneratedTerminalQcLegacyKeys(ops)).toHaveLength(1);
  });

  it('leaves a Final Inspection that is NOT last exactly where it is', () => {
    // The shape the legacy keys were built against: something sits after it, so
    // the old strip took nothing out and the inspection was counted.
    const ops = [op('a1', 'process', 'Turning'), FI('fi'), op(null, 'process', 'Deburring')];
    expect(withoutTrailingGeneratedTerminalQcLegacyKeys(ops)).toHaveLength(3);
  });

  it('leaves an ordinary last op, and an ordinary QC last op, alone', () => {
    expect(
      withoutTrailingGeneratedTerminalQcLegacyKeys([op('a1', 'process', 'Turning')]),
    ).toHaveLength(1);
    expect(withoutTrailingGeneratedTerminalQcLegacyKeys([op('q1', 'qc', 'MIR')])).toHaveLength(1);
    expect(withoutTrailingGeneratedTerminalQcLegacyKeys([])).toHaveLength(0);
  });

  it('never mutates the list it was given', () => {
    const ops = [op('a1', 'process', 'Turning'), FI('fi')];
    withoutTrailingGeneratedTerminalQcLegacyKeys(ops);
    expect(ops).toHaveLength(2);
  });
});

describe('proposedOpsForStagedKeys — one rule, the legacy split inside it', () => {
  const payload = [op('a1', 'process', 'Turning'), FI('fi'), op(null, 'process', 'Deburring')];

  it('strips by the CARRIED id, wherever the inspection sits', () => {
    expect(proposedOpsForStagedKeys(payload, 'fi').map((o) => o.operation)).toEqual([
      'Turning',
      'Deburring',
    ]);
  });

  it('strips nothing when the payload says there was no generated inspection (null)', () => {
    expect(proposedOpsForStagedKeys(payload, null)).toHaveLength(3);
  });

  it('falls back to the POSITIONAL strip only when no id was carried at all', () => {
    // undefined = a legacy row. Nothing is taken out here, because the inspection
    // is not last — which is exactly how its keys were numbered.
    expect(proposedOpsForStagedKeys(payload, undefined)).toHaveLength(3);
    expect(proposedOpsForStagedKeys(payload, undefined)[1]?.id).toBe('fi');
  });

  it('is what the real staging path produces, end to end', () => {
    const frozen = withStagedTerminalQcOpId({ ops: payload }, 'fi');
    expect(proposedOpsForStagedKeys(frozen.ops, stagedTerminalQcOpId(frozen))).toHaveLength(2);
  });
});

describe('a LEGACY op:add index resolves to the operation it was built for', () => {
  // The IN-JC-26-00025 shape, staged before the id was carried: Cutting, Milling,
  // the system's Final Inspection, and the operation the person added AFTER it.
  // The old positional strip took nothing out (the inspection is not last), so
  // the addition was keyed `op:add:3`.
  const legacyPayload = [
    op('c1', 'outsource', 'Cutting'),
    op('m1', 'process', 'Milling'),
    FI('fi'),
    op(null, 'process', 'Deburring'),
  ];
  const kept = [op('c1', 'outsource', 'Cutting'), op('m1', 'process', 'Milling')];

  it('the legacy read finds Deburring at index 3 and adds it', () => {
    const proposed = proposedOpsForStagedKeys(legacyPayload, undefined);
    expect(proposed[3]?.operation).toBe('Deburring');
    const out = withApprovedOpAdds(kept, proposed, [3]);
    expect(out.map((x) => x.operation)).toEqual(['Cutting', 'Milling', 'Deburring']);
  });

  it('re-deriving an id instead ROLLS THE DECISION BACK (index past the end)', () => {
    // What the code did before this round: strip by the id the stored routing
    // ends with now. The list is one shorter, index 3 is off the end, and the
    // throw inside applyEdit rolls back the whole approve/reject decision — the
    // request stays pending and the approver cannot clear it.
    const misStripped = withoutOpId(legacyPayload, 'fi');
    expect(misStripped).toHaveLength(3);
    expect(() => withApprovedOpAdds(kept, misStripped, [3])).toThrow(JC_OP_ADD_UNRESOLVED_MESSAGE);
  });

  it('and with one more added op it would have added the WRONG one', () => {
    // Two additions after the inspection. The legacy keys are 3 (Deburring) and
    // 4 (Marking). Stripping by id shifts them: index 3 becomes Marking — and it
    // has no id, so nothing throws. The right operation is simply replaced by the
    // wrong one, silently. This is the case the positional read prevents.
    const twoAdds = [...legacyPayload, op(null, 'process', 'Marking')];
    const misStripped = withoutOpId(twoAdds, 'fi');
    expect(misStripped[3]?.operation).toBe('Marking'); // the wrong operation...
    expect(misStripped[3]?.id).toBeNull(); // ...and no stored id, so no throw
    expect(withApprovedOpAdds(kept, misStripped, [3]).map((x) => x.operation)).toEqual([
      'Cutting',
      'Milling',
      'Marking',
    ]);
    // Read the way the keys were built, index 3 is the operation the box named.
    const proposed = proposedOpsForStagedKeys(twoAdds, undefined);
    expect(proposed[3]?.operation).toBe('Deburring');
    expect(withApprovedOpAdds(kept, proposed, [3]).map((x) => x.operation)).toEqual([
      'Cutting',
      'Milling',
      'Deburring',
    ]);
  });

  it('still THROWS when the resolved entry already has an id (never adds it)', () => {
    // The assertion that must stay: an entry WITH an id is a stored operation, so
    // there is nothing to add. Adding it anyway would duplicate it.
    const proposed = proposedOpsForStagedKeys(legacyPayload, undefined);
    expect(proposed[2]?.id).toBe('fi');
    expect(() => withApprovedOpAdds(kept, proposed, [2])).toThrow(ConflictError);
    expect(() => withApprovedOpAdds(kept, proposed, [2])).toThrow(JC_OP_ADD_UNRESOLVED_MESSAGE);
  });
});
