// Job Card OPERATION edits under the Document Edit Approval gate (ADR-227).
//
// The one insight the whole file turns on: the system's own "Final Inspection"
// and one a PERSON placed mid-route are identical by name AND by type. Only the
// stored row id tells them apart. So every rule here is decided on the id the
// STORED routing ends with — never on the name, and never on a position in the
// list the browser posted.
//
// Pure functions only — no database. The three pieces:
//   assertTerminalQcUnchanged  the three refusals that protect the generated op
//   jcOpsChanged               "did the OTHER operations change?"
//   diffFields / buildFilteredInput  what turns a change into approval boxes
//
// WHY assertTerminalQcUnchanged is asked FIRST, outside the change gate:
// jcOpsChanged compares both lists with the Final Inspection stripped out by id,
// so an edit that touches ONLY the Final Inspection compares EQUAL. If the
// refusals sat behind that gate the person would be told "Nothing changed to
// approve" and the change would be silently dropped — the test
// '…refuses it even though nothing else changed' below is that proof.

import { describe, expect, it } from 'vitest';
import {
  grandfatheredOspQcPairs,
  qcAfterOutsourceError,
  stripStaleGeneratedTerminalQc,
} from '@innovic/shared';
import type { DocEditTarget } from '../document-edits/registry';
import { ConflictError, ValidationError } from '../../lib/errors';
import { terminalQcOp, withoutOpId, withStagedTerminalQcOpId } from './jc-op-edit';
import { jobCardEditRegistryEntry } from './jobcard-edit-registry';
import type { JcOpInput } from './schema';
import {
  assertJcOpsStageable,
  assertTerminalQcUnchanged,
  type JcOpEditRow,
  jcEditRemovesLastProductionOp,
  jcEmptyRoutingMessage,
  jcHasProductionOp,
  jcNoProductionOpMessage,
  jcOpsChanged,
  TERMINAL_QC_DISPLACED_MESSAGE,
  TERMINAL_QC_REPLACED_MESSAGE,
  TERMINAL_QC_STARTED_REMOVED_MESSAGE,
  TERMINAL_QC_STARTED_RESEQUENCED_MESSAGE,
  worstApprovableSubset,
} from './service';
import { needsDefaultQcOp } from '../../lib/jc-default-qc';

const CODE = 'IN-JC-26-00025';

/** A STORED operation (one jc_ops row as the edit loader projects it). */
function stored(
  id: string,
  opSeq: number,
  operation: string,
  opType: string,
  extra: { started?: boolean; committed?: boolean; hasNc?: boolean } = {},
): JcOpEditRow {
  return {
    id,
    opSeq,
    operation,
    opType,
    machineCode: opType === 'process' ? 'M1' : null,
    outsourceVendorCode: opType === 'outsource' ? 'V1' : null,
    cycleTimeMin: 0,
    program: null,
    toolNo: null,
    toolDetails: null,
    qcRequired: opType === 'qc',
    outsourceCost: 0,
    started: extra.started ?? false,
    committed: extra.committed ?? false,
    hasNc: extra.hasNc ?? false,
  };
}

/** An operation as the BROWSER posts it. No id = newly added. */
function posted(o: { id?: string; operation: string; opType: JcOpInput['opType'] }): JcOpInput {
  return {
    ...(o.id ? { id: o.id } : {}),
    operation: o.operation,
    opType: o.opType,
    machineCode: o.opType === 'process' ? 'M1' : null,
    outsourceVendorCode: o.opType === 'outsource' ? 'V1' : null,
    cycleTimeMin: 0,
    program: null,
    toolNo: null,
    toolDetails: null,
    qcRequired: o.opType === 'qc',
    outsourceCost: 0,
  };
}

/** The stored routing posted straight back, unchanged — what the form sends
 *  when the person only edited a header field. */
const asPosted = (rows: JcOpEditRow[]): JcOpInput[] =>
  rows.map((r) =>
    posted({ id: r.id, operation: r.operation, opType: r.opType as JcOpInput['opType'] }),
  );

/** The shape jcOpsChanged compares (updateJobCardOrStage's own mapping). */
const comparable = (rows: JcOpEditRow[]) =>
  rows.map((c) => ({
    id: c.id,
    operation: c.operation,
    opType: c.opType,
    cycleTimeMin: c.cycleTimeMin,
    machineCodeText: c.machineCode,
    program: c.program,
    toolNo: c.toolNo,
    toolDetails: c.toolDetails,
    qcRequired: c.qcRequired,
    outsourceVendorText: c.outsourceVendorCode,
    outsourceCost: c.outsourceCost,
  }));

/** The locked target the approval engine hands the registry: the stored routing
 *  with the generated Final Inspection projected out, plus its id. */
const target = (all: JcOpEditRow[], terminalQcOpId: string | null): DocEditTarget => ({
  doc: {
    jcDate: '2026-10-09',
    itemCode: 'ITEM-1',
    orderQty: 10,
    priority: 'normal',
    dueDate: null,
    remarks: null,
    drawingFilePath: null,
    ops: withoutOpId(all, terminalQcOpId),
    terminalQcOpId,
  },
  updatedAt: null,
  docCode: CODE,
  isLive: true,
});

/** diffFields exactly as the engine calls it. ADR-227: the payload it is given
 *  always CARRIES the staged Final Inspection id — updateJobCardOrStage attaches
 *  it before the request is frozen (requestDocumentEdit stores that payload, and
 *  the decide path reads the same one back). For these tests that id is the one
 *  the target was built with, so attaching it here keeps the simulation honest:
 *  a payload with no id at all is a LEGACY row, and legacy rows are read back
 *  POSITIONALLY (proposedOpsForStagedKeys) — covered in jc-op-edit.test.ts. */
const opKeys = (t: DocEditTarget, payload: { ops: JcOpInput[] }): string[] =>
  jobCardEditRegistryEntry
    .diffFields(
      t,
      withStagedTerminalQcOpId(payload, (t.doc['terminalQcOpId'] as string | null) ?? null),
    )
    .map((f) => f.key)
    .filter((k) => k.startsWith('op:'));

// The routing of the live card: cutting is outsourced, then milling, then the
// Final Inspection the SYSTEM added. 'fi' is the stored Final Inspection's id.
const LIVE = [
  stored('c1', 1, 'Cutting', 'outsource'),
  stored('m1', 2, 'Milling', 'process'),
  stored('fi', 3, 'Final Inspection', 'qc'),
];

/** How the real caller finds the op to protect: by POSITION, in the STORED
 *  routing, where the generated one really is last. */
const storedTerminal = (rows: JcOpEditRow[]) => terminalQcOp(rows) ?? null;

describe('assertTerminalQcUnchanged — the DISPLACED routing is refused', () => {
  it("refuses an operation placed AFTER the system's Final Inspection", () => {
    // THE CAUSE OF THE LIVE DUPLICATE (IN-JC-26-00025): with a machining op
    // after it the routing ends in `process` again, so the writer appended a
    // SECOND Final Inspection and stranded the first mid-route. The state is
    // refused; the append is NOT suppressed, because a card that really does end
    // on machining must still get its terminal QC or its finished pieces are
    // never credited to stock.
    const proposedAll = [...asPosted(LIVE), posted({ operation: 'Deburring', opType: 'process' })];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).toThrow(
      ValidationError,
    );
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).toThrow(
      'Final Inspection must stay the last operation. Move it back to the end, or remove the operation after it.',
    );
  });

  it('refuses it even though nothing else changed (the gate-ordering defect)', () => {
    // Both lists, stripped of the Final Inspection by id, are IDENTICAL — so
    // "did the operations change?" answers NO. Had the refusal sat behind that
    // gate, the person would have been told "Nothing changed to approve".
    // A pure RENAME of the Final Inspection: the only change on the card.
    const renamed = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Check', opType: 'qc' }),
    ];
    expect(
      jcOpsChanged(comparable(withoutOpId(LIVE, 'fi')), withoutOpId(renamed, 'fi'), true),
    ).toBe(false);
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), renamed)).toThrow(
      'Final Inspection is added by the system and cannot be renamed here.',
    );
  });

  it('does NOT fire for a DIFFERENT op that merely shares the name', () => {
    // Two ops named "Final Inspection": 'mid' is the person's own, 'fi' is the
    // system's. The person adds an op after their OWN one. Legal — the system's
    // op is still last.
    const rows = [
      stored('a1', 1, 'Turning', 'process'),
      stored('mid', 2, 'Final Inspection', 'qc'),
      stored('a2', 3, 'Milling', 'process'),
      stored('fi', 4, 'Final Inspection', 'qc'),
    ];
    const proposedAll = [
      posted({ id: 'a1', operation: 'Turning', opType: 'process' }),
      posted({ id: 'mid', operation: 'Final Inspection', opType: 'qc' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'a2', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(rows), proposedAll)).not.toThrow();
  });

  it("does NOT fire on a card whose Final Inspection is the person's own", () => {
    // No generated op on this card at all (the stored routing does not END with
    // one), so there is nothing to protect and the mid-route inspection may sit
    // wherever the person wants it.
    const rows = [
      stored('a1', 1, 'Turning', 'process'),
      stored('mid', 2, 'Final Inspection', 'qc'),
      stored('a2', 3, 'Milling', 'process'),
    ];
    expect(storedTerminal(rows)).toBeNull();
    const proposedAll = [...asPosted(rows), posted({ operation: 'Deburring', opType: 'process' })];
    expect(() => assertTerminalQcUnchanged(storedTerminal(rows), proposedAll)).not.toThrow();
  });

  it('is happy when the Final Inspection is still last', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).not.toThrow();
  });

  it('shares ONE wording with the writer', () => {
    expect(TERMINAL_QC_DISPLACED_MESSAGE).toBe(
      'Final Inspection must stay the last operation. Move it back to the end, or remove the operation after it.',
    );
  });
});

describe('assertTerminalQcUnchanged — rename, retype and removal', () => {
  it('refuses a RENAME in plain words', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Check', opType: 'qc' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).toThrow(
      ValidationError,
    );
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).toThrow(
      'Final Inspection is added by the system and cannot be renamed here.',
    );
  });

  it('refuses a RETYPE (qc → process) with the same message', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'process' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).toThrow(
      'Final Inspection is added by the system and cannot be renamed here.',
    );
  });

  it('refuses a DELETE while the routing still ends at a machining step', () => {
    // Previously this produced NO box at all and the person was still told the
    // edit had been sent for approval.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).toThrow(
      'Final Inspection is added by the system and cannot be removed here.',
    );
  });

  it('ALLOWS it to disappear when the routing now ends at an outsource step', () => {
    // The person adds an OSP step as the last real operation. ADR-179: such a
    // routing gets no terminal QC (the pieces are credited when they come back),
    // so the browser legitimately stops sending the Final Inspection and the
    // writer soft-deletes it. Not a deletion by hand — must not be refused.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Plating', opType: 'outsource' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).not.toThrow();
  });

  it('ALLOWS it to disappear when the routing now ends at another QC step', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'TPI', opType: 'qc' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), proposedAll)).not.toThrow();
  });

  it('ALLOWS an empty routing through — the empty-routing refusal is elsewhere', () => {
    // Rule B has nothing to inspect, so this function stays silent; the "must
    // keep at least one operation" refusal belongs to assertJcOpsStageable and
    // to the writer.
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), [])).not.toThrow();
  });

  it('refuses the delete on a rework / repair child whatever the last op is', () => {
    // Interlock 3: a recovery child ALWAYS ends with an inspection, so its
    // Final Inspection can never legitimately vanish from the payload.
    const child = [
      stored('r1', 1, 'Rework Turning', 'process'),
      stored('fi', 2, 'Final Inspection', 'qc'),
    ];
    const proposedAll = [
      posted({ id: 'r1', operation: 'Rework Turning', opType: 'process' }),
      posted({ operation: 'Re-plating', opType: 'outsource' }),
    ];
    expect(() =>
      assertTerminalQcUnchanged(storedTerminal(child), proposedAll, { recoveryKind: 'rework' }),
    ).toThrow('Final Inspection is added by the system and cannot be removed here.');
    // Without the recovery flag the very same payload is legitimate (it now ends
    // at an outsource step), which is why the flag has to be threaded through.
    expect(() => assertTerminalQcUnchanged(storedTerminal(child), proposedAll)).not.toThrow();
  });

  it('does nothing at all when the card has no generated Final Inspection', () => {
    const rows = [stored('a1', 1, 'Turning', 'process'), stored('q1', 2, 'MIR', 'qc')];
    expect(() => assertTerminalQcUnchanged(storedTerminal(rows), [])).not.toThrow();
    expect(() => assertTerminalQcUnchanged(storedTerminal(rows), asPosted(rows))).not.toThrow();
  });
});

describe('assertJcOpsStageable — adding an operation to a card that has a Final Inspection', () => {
  it('does NOT report "the operations changed while you were editing" (the reported defect)', () => {
    // The new op goes in BEFORE the Final Inspection (where the form puts it).
    // The old code stripped each list by position, dropped a DIFFERENT op from
    // each, and read the surviving Final Inspection as "someone else changed
    // this routing".
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).not.toThrow();
  });

  it('sees it as a change (so it is staged, not silently ignored)', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    const current = withoutOpId(LIVE, 'fi');
    const proposed = withoutOpId(proposedAll, 'fi');
    expect(jcOpsChanged(comparable(current), proposed, true)).toBe(true);
  });

  it('carries the displaced-routing refusal too (ONE copy of the rule)', () => {
    const proposedAll = [...asPosted(LIVE), posted({ operation: 'Deburring', opType: 'process' })];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).toThrow(
      TERMINAL_QC_DISPLACED_MESSAGE,
    );
  });

  it('carries the rename and removal refusals too', () => {
    const renamed = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Check', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, renamed, true)).toThrow(
      'Final Inspection is added by the system and cannot be renamed here.',
    );
    const deleted = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, deleted, true)).toThrow(
      'Final Inspection is added by the system and cannot be removed here.',
    );
  });

  it('produces exactly ONE "added" box, and nothing about the Final Inspection', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    const keys = opKeys(target(LIVE, 'fi'), { ops: proposedAll });
    expect(keys.filter((k) => k.startsWith('op:add:'))).toEqual(['op:add:2']);
    // The system's own op gets no box of any kind — neither an attribute box
    // nor a "removed" one.
    expect(keys.some((k) => k.includes('fi'))).toBe(false);
  });

  it('the "added" box index points at the SAME operation applyEdit will read', () => {
    // THE INVARIANT: `op:add:<index>` indexes the proposed routing with the
    // stored Final Inspection taken out. diffFields builds the key from the
    // stripped list; buildFilteredInput hands the payload on UNSTRIPPED and
    // applyEdit strips it by the same id. Both must land on 'Deburring'.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    const keys = opKeys(target(LIVE, 'fi'), { ops: proposedAll });
    const addKey = keys.find((k) => k.startsWith('op:add:'))!;
    const index = Number(addKey.split(':')[2]);

    const filtered = jobCardEditRegistryEntry.buildFilteredInput(
      { ops: proposedAll },
      new Set([addKey]),
    ) as { approvedOps: { adds: number[] }; proposedOpsRaw: JcOpInput[] };
    expect(filtered.approvedOps.adds).toEqual([index]);
    // Unstripped on the way through...
    expect(filtered.proposedOpsRaw).toHaveLength(4);
    // ...and stripped by the stored id the way applyEdit does it.
    expect(withoutOpId(filtered.proposedOpsRaw, 'fi')[index]?.operation).toBe('Deburring');
  });
});

describe('assertJcOpsStageable — routings with no generated Final Inspection', () => {
  it('a routing that does not end in Final Inspection is left exactly as it was', () => {
    const rows = [stored('a1', 1, 'Turning', 'process'), stored('q1', 2, 'MIR', 'qc')];
    const proposedAll = asPosted(rows);
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
    expect(jcOpsChanged(comparable(rows), proposedAll, true)).toBe(false);
    expect(opKeys(target(rows, null), { ops: proposedAll })).toContain('op:a1:operation');
  });

  it('a routing ending at an outsource step still has no terminal QC to protect', () => {
    const rows = [stored('a1', 1, 'Turning', 'process'), stored('o1', 2, 'Plating', 'outsource')];
    const proposedAll = asPosted(rows);
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
    expect(jcOpsChanged(comparable(rows), proposedAll, true)).toBe(false);
  });

  it('a Final Inspection the PERSON adds gets its own "added" box', () => {
    // No generated op on this card, so nothing is stripped and the new row is
    // an ordinary added operation the approver can accept or reject.
    const rows = [stored('a1', 1, 'Turning', 'process'), stored('q1', 2, 'MIR', 'qc')];
    const proposedAll = [
      ...asPosted(rows),
      posted({ operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
    const keys = opKeys(target(rows, null), { ops: proposedAll });
    expect(keys.filter((k) => k.startsWith('op:add:'))).toEqual(['op:add:2']);
  });

  it("two ops both named Final Inspection — only the LAST one is the system's", () => {
    // The mid-route one is the person's own operation: it keeps its boxes. The
    // terminal one still gets none, and must stay last.
    const rows = [
      stored('a1', 1, 'Turning', 'process'),
      stored('mid', 2, 'Final Inspection', 'qc'),
      stored('a2', 3, 'Milling', 'process'),
      stored('fi', 4, 'Final Inspection', 'qc'),
    ];
    const proposedAll = [
      posted({ id: 'a1', operation: 'Turning', opType: 'process' }),
      posted({ id: 'mid', operation: 'Final Inspection', opType: 'qc' }),
      posted({ id: 'a2', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
    const keys = opKeys(target(rows, 'fi'), { ops: proposedAll });
    expect(keys).toContain('op:mid:operation');
    expect(keys.some((k) => k.includes('fi'))).toBe(false);
  });
});

describe('assertJcOpsStageable — the guards it already had still fire', () => {
  it('still refuses a routing emptied of every real operation', () => {
    // Only the generated Final Inspection left in the payload: operations, but no
    // work — the production-operation wording, the same one the writer uses.
    expect(() => assertJcOpsStageable(CODE, LIVE, [asPosted(LIVE)[2]!], true)).toThrow(
      jcNoProductionOpMessage(CODE),
    );
  });

  it('still reports a genuine concurrent change (an op id that is no longer there)', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'gone', operation: 'Grinding', opType: 'process' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).toThrow(ConflictError);
  });

  it('still refuses re-ordering two real operations', () => {
    const proposedAll = [
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).toThrow(
      'Changing the order of operations cannot go for approval',
    );
  });

  it('still refuses removing an operation that already has logged work', () => {
    const rows = [
      stored('c1', 1, 'Cutting', 'outsource', { started: true }),
      stored('m1', 2, 'Milling', 'process'),
      stored('fi', 3, 'Final Inspection', 'qc'),
    ];
    const proposedAll = [
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).toThrow(
      'it already has logged work',
    );
  });
});

/** Whether `fn` threw — lets a case table state throw-or-not per save path. */
function didThrow(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// ADR-227 — the rule is PATH-INDEPENDENT.
//
// assertTerminalQcUnchanged has TWO call sites and they must answer identically,
// because which one runs depends only on whether the company has the Document
// Edit Approval gate switched on:
//
//   1. updateJobCardTx (service.ts) — THE WRITER. Every save reaches it: a
//      direct edit with the gate OFF, and the approval apply path
//      (jobcard-edit-registry.applyEdit) too. It calls the function with
//      `userOps` — input.ops AFTER stripStaleGeneratedTerminalQc — which is
//      exactly the routing it is about to write.
//   2. updateJobCardOrStage (service.ts) — the staging pre-check, gate ON. It
//      refuses BEFORE staging, so a change the writer would reject at approval
//      time never becomes an approval box nobody can act on.
//
// The hole this closes: the writer used to carry only a DISPLACEMENT check of
// its own, so with the gate OFF a RENAME of the generated Final Inspection was
// accepted and persisted (still last, still 'qc'), after which nothing could
// recognise the row again and the card lost its ADR-227 protection for good; and
// a hand-DELETE was silently undone by re-appending a row with a NEW id instead
// of being refused. Same user action, different answer per company.
//
// No database here on purpose: updateJobCardTx needs one, so these cases assert
// on the pure function fed the SAME list the writer feeds it, through the real
// stripStaleGeneratedTerminalQc.
describe('assertTerminalQcUnchanged — same answer on the WRITER path (updateJobCardTx)', () => {
  /** What updateJobCardTx hands the rule: input.ops after the stale-op strip. */
  const writerOps = (
    proposedAll: JcOpInput[],
    opts: { recoveryKind?: string | null; startedIds?: string[] } = {},
  ): JcOpInput[] =>
    stripStaleGeneratedTerminalQc(proposedAll, {
      recoveryKind: opts.recoveryKind ?? null,
      isStarted: (o) => !!o.id && (opts.startedIds ?? []).includes(o.id),
    });

  /** The writer's exact call, for the LIVE card. */
  const onWriterPath = (proposedAll: JcOpInput[]) =>
    assertTerminalQcUnchanged(storedTerminal(LIVE), writerOps(proposedAll), {
      recoveryKind: null,
    });

  it('REFUSES a rename on the writer path (was accepted and persisted with the gate off)', () => {
    const renamed = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Check', opType: 'qc' }),
    ];
    // The strip leaves the row alone (it no longer carries the generated name),
    // so the writer sees it LAST — the exact state that used to pass both of the
    // writer's old guards.
    expect(writerOps(renamed)).toHaveLength(3);
    expect(() => onWriterPath(renamed)).toThrow(ValidationError);
    expect(() => onWriterPath(renamed)).toThrow(
      'Final Inspection is added by the system and cannot be renamed here.',
    );
  });

  it('REFUSES a retype (qc to process) on the writer path', () => {
    const retyped = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'process' }),
    ];
    expect(() => onWriterPath(retyped)).toThrow(
      'Final Inspection is added by the system and cannot be renamed here.',
    );
  });

  it('REFUSES a hand-delete on the writer path (was silently re-appended with a NEW id)', () => {
    const deleted = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
    ];
    expect(() => onWriterPath(deleted)).toThrow(
      'Final Inspection is added by the system and cannot be removed here.',
    );
  });

  it('REFUSES the displaced routing on the writer path (its one existing guard)', () => {
    const displaced = [...asPosted(LIVE), posted({ operation: 'Deburring', opType: 'process' })];
    expect(() => onWriterPath(displaced)).toThrow(TERMINAL_QC_DISPLACED_MESSAGE);
  });

  it('ALLOWS the legitimate removal: the routing now ends at an outsource step', () => {
    // The person retypes the last real op to OSP. stripStaleGeneratedTerminalQc
    // drops the generated Final Inspection (ADR-179 gives such a routing no
    // terminal QC), so the writer gets a list WITHOUT it — and that must read as
    // "absent and not needed", never as a deletion by hand.
    const endsAtOsp = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(writerOps(endsAtOsp).map((o) => o.id)).toEqual(['c1', 'm1']);
    expect(() => onWriterPath(endsAtOsp)).not.toThrow();
  });

  it('ALLOWS a new outsource step added as the last operation', () => {
    const addedOsp = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Plating', opType: 'outsource' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(writerOps(addedOsp).map((o) => o.operation)).toEqual(['Cutting', 'Milling', 'Plating']);
    expect(() => onWriterPath(addedOsp)).not.toThrow();
  });

  it('still REFUSES the removal on a rework / repair child on the writer path', () => {
    // Interlock 3: a recovery child always ends with an inspection, so the strip
    // keeps its op (recoveryKind set) and the rule refuses the absence outright.
    const child = [
      stored('r1', 1, 'Rework Turning', 'process'),
      stored('fi', 2, 'Final Inspection', 'qc'),
    ];
    const withoutFi = [
      posted({ id: 'r1', operation: 'Rework Turning', opType: 'process' }),
      posted({ operation: 'Re-plating', opType: 'outsource' }),
    ];
    expect(() =>
      assertTerminalQcUnchanged(
        storedTerminal(child),
        stripStaleGeneratedTerminalQc(withoutFi, { recoveryKind: 'rework' }),
        { recoveryKind: 'rework' },
      ),
    ).toThrow('Final Inspection is added by the system and cannot be removed here.');
  });

  it('gives the SAME answer as the staging pre-check for every one of those payloads', () => {
    // Path-independence stated directly: throw-or-not must match, case by case.
    const renamed = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Check', opType: 'qc' }),
    ];
    const deleted = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
    ];
    const displaced = [...asPosted(LIVE), posted({ operation: 'Deburring', opType: 'process' })];
    const unchanged = asPosted(LIVE);
    const cases: Array<{ what: string; ops: JcOpInput[]; refused: boolean }> = [
      { what: 'rename', ops: renamed, refused: true },
      { what: 'hand-delete', ops: deleted, refused: true },
      { what: 'displaced', ops: displaced, refused: true },
      { what: 'unchanged routing', ops: unchanged, refused: false },
    ];
    for (const c of cases) {
      // writer path
      expect(didThrow(() => onWriterPath(c.ops))).toBe(c.refused);
      // staging path (assertJcOpsStageable is what updateJobCardOrStage reaches)
      expect(didThrow(() => assertJcOpsStageable(CODE, LIVE, c.ops, true))).toBe(c.refused);
    }
  });

  it('the approval apply path resubmits a routing that passes all three refusals', () => {
    // jobcard-edit-registry.applyEdit rebuilds the routing from the CURRENT ops
    // and ends with `if (terminal) ops.push(toInput(terminal))` — the STORED op,
    // keeping its stored id, its stored operation name and its stored opType, in
    // LAST place, after every approved addition has been spliced in. So on a
    // legitimate approval none of the three refusals can fire. This is that shape.
    const terminal = storedTerminal(LIVE)!;
    const rebuilt: JcOpInput[] = [
      ...withoutOpId(LIVE, terminal.id).map((o) =>
        posted({ id: o.id, operation: o.operation, opType: o.opType as JcOpInput['opType'] }),
      ),
      posted({ operation: 'Deburring', opType: 'process' }), // the approved addition
      // toInput(terminal): same id, same operation, same opType — never re-derived.
      posted({
        id: terminal.id,
        operation: terminal.operation,
        opType: terminal.opType as JcOpInput['opType'],
      }),
    ];
    expect(() => onWriterPath(rebuilt)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (sixth review round) — A FINAL INSPECTION THAT HAS ALREADY INSPECTED
// PIECES MAY NOT BE RE-NUMBERED.
//
// The generated Final Inspection's op_seq is always "(number of operations
// before it) + 1" — the writer renumbers every kept op to its position in the
// payload on every save. So adding or removing ANY operation in front of it
// moves it, and once it has logged work the writer refuses that move outright
// ("Cannot move Op 30 — it already has logged work").
//
// THE FAILURE THIS CLOSES: the card ends Turning, Milling, Final Inspection, and
// the inspection already has a QC log. The person's Edit page was opened BEFORE
// that log existed, so the browser's own add-block did not apply and "+ Add Op"
// was live. The new op goes in before the inspection, the staging pre-check (which
// strips the inspection from both lists before it looks at anything) passes, an
// `op:add:2` box is staged — and at approval the writer throws, which rolls back
// the WHOLE approval and leaves the approver with an error they cannot clear.
// Before ADR-227 the add landed AFTER the inspection, so its op_seq never moved
// and the approval went through: this failure is new, and the only other guard
// is client-side and can be stale.
describe('assertJcOpsStageable — a Final Inspection that has already inspected pieces', () => {
  /** The same live card, but its Final Inspection now carries a QC log. */
  const STARTED_FI = [
    stored('c1', 1, 'Cutting', 'outsource'),
    stored('m1', 2, 'Milling', 'process'),
    stored('fi', 3, 'Final Inspection', 'qc', { started: true }),
  ];

  it('refuses an operation ADDED before it, in words the shop floor can act on', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      ValidationError,
    );
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      TERMINAL_QC_STARTED_RESEQUENCED_MESSAGE,
    );
  });

  it('refuses a REMOVAL before it too — that re-numbers it just the same', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      TERMINAL_QC_STARTED_RESEQUENCED_MESSAGE,
    );
  });

  it('shares ONE wording for it', () => {
    expect(TERMINAL_QC_STARTED_RESEQUENCED_MESSAGE).toBe(
      'Final Inspection has already inspected some pieces, so an operation can no longer be added or removed before it — that would move Final Inspection. Raise a rework Job Card for the extra work instead.',
    );
  });

  // ---- SEVENTH ROUND: EVERY APPROVABLE SUBSET, not just the whole proposal ---
  //
  // THE HOLE THE COUNT TEST LEFT. Approval is box by box. An edit that REMOVES
  // one operation and ADDS another keeps the count identical, so the count test
  // let it be staged — and then the approver approved the removal and rejected
  // the addition, which is their right. applyEdit built a routing one operation
  // shorter, pushed the Final Inspection last, and the writer threw
  // "Cannot move Op 30 — it already has logged work" INSIDE applyEdit: the whole
  // decision rolled back, the request stayed pending, and the only way to clear
  // it was to reject everything. So the rule is now per-change, not per-proposal.
  it('refuses a remove-one-and-add-one edit, even though the count balances', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      // 'm1' (Milling) is gone...
      posted({ operation: 'Deburring', opType: 'process' }), // ...and a new op takes its place
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    // Same number of operations in front of the inspection as the stored routing
    // has — which is exactly why the count test passed it.
    expect(withoutOpId(proposedAll, 'fi')).toHaveLength(withoutOpId(STARTED_FI, 'fi').length);
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      ValidationError,
    );
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      TERMINAL_QC_STARTED_RESEQUENCED_MESSAGE,
    );
  });

  it('refuses two removals and two additions too (any balanced swap)', () => {
    const proposedAll = [
      posted({ operation: 'Facing', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      TERMINAL_QC_STARTED_RESEQUENCED_MESSAGE,
    );
  });

  it('still allows a pure ATTRIBUTE edit in front of it — the case people need', () => {
    // Machine, cycle time, program, tool, QC flag, vendor, cost. No subset of
    // these can move the inspection: every operation keeps its place, so each gets
    // its own box and the approver can take any of them.
    const proposedAll = [
      { ...posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }), outsourceCost: 125 },
      {
        ...posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
        machineCode: 'M7',
        cycleTimeMin: 12,
        program: 'PRG-7',
        toolNo: 'T-9',
        qcRequired: false,
      },
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).not.toThrow();
    // ...and it really does produce approval boxes, one per attribute changed.
    const keys = opKeys(target(STARTED_FI, 'fi'), { ops: proposedAll });
    expect(keys).toContain('op:c1:outsourceCost');
    expect(keys).toContain('op:m1:machineCode');
  });

  it('allows that same balanced swap while the inspection is UN-STARTED', () => {
    // The whole difference is the QC log. An un-started inspection is simply
    // re-numbered on save, so remove-one-and-add-one stays an ordinary edit.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).not.toThrow();
  });

  // ---- the legitimate cases, which must all still pass -------------------
  it('leaves the routing posted straight back alone (a header-only edit)', () => {
    // A header-only edit does not reach this function at all (the ops did not
    // change), but the same payload must also pass when it does — an added or
    // removed op is the only thing being refused, never an unchanged routing.
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, asPosted(STARTED_FI), true)).not.toThrow();
  });

  it('still allows an EDIT to an operation in front of it (the count is the same)', () => {
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Finish Milling', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).not.toThrow();
  });

  it('does NOT fire while the Final Inspection has no logged work (the normal case)', () => {
    // LIVE is the same card with an un-started inspection: adding an operation
    // simply re-numbers it on save, which is why this stayed legal before any QC
    // log existed. Nothing about the ordinary add may change.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).not.toThrow();
  });

  it('still allows the inspection to go when the last real op becomes outsource', () => {
    // ADR-179: a routing that ends at an outsource step gets no terminal QC (the
    // pieces are credited when they come back), so the browser legitimately stops
    // sending it. The count of operations in front of it is unchanged, so this
    // passes even though the routing lost a row.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).not.toThrow();
  });

  it('refuses that same DROP once the inspection has inspected pieces', () => {
    // The sibling hole: ADR-179 lets the inspection disappear when the last real
    // op is retyped to outsource, but an inspection that has already passed pieces
    // cannot be dropped either — the writer refuses the identical payload with
    // "Cannot remove Op 30 — it already has logged work", which again leaves the
    // approver with an error they cannot clear. Refused at staging instead.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
    ];
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      ValidationError,
    );
    expect(() => assertJcOpsStageable(CODE, STARTED_FI, proposedAll, true)).toThrow(
      TERMINAL_QC_STARTED_REMOVED_MESSAGE,
    );
  });

  it('started-or-not is the WHOLE difference for that drop', () => {
    // Pinned as a pair so nobody re-widens it: one and the same payload, two
    // cards that differ ONLY in whether the Final Inspection has logged work.
    const dropsTheInspection = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
    ];
    const cases: Array<{ what: string; rows: JcOpEditRow[]; refused: boolean }> = [
      { what: 'un-started Final Inspection', rows: LIVE, refused: false },
      { what: 'Final Inspection with a QC log', rows: STARTED_FI, refused: true },
    ];
    for (const c of cases) {
      expect(didThrow(() => assertJcOpsStageable(CODE, c.rows, dropsTheInspection, true))).toBe(
        c.refused,
      );
    }
  });

  it('shares ONE wording for the drop too', () => {
    expect(TERMINAL_QC_STARTED_REMOVED_MESSAGE).toBe(
      'Final Inspection has already inspected some pieces, so it can no longer be removed from this Job Card. Undo the change to the last operation, or raise a rework Job Card for the extra work instead.',
    );
  });

  it('does not fire on a card with no generated Final Inspection at all', () => {
    // Nothing to protect: the stored routing does not end with the system's own
    // op, so the count rule has no subject — the op count changes here and the
    // add is still allowed. (A started op may not MOVE, which is the older guard
    // and unchanged, so the new op goes at the end.)
    const rows = [
      stored('a1', 1, 'Turning', 'process'),
      stored('q1', 2, 'MIR', 'qc', { started: true }),
    ];
    const proposedAll = [
      posted({ id: 'a1', operation: 'Turning', opType: 'process' }),
      posted({ id: 'q1', operation: 'MIR', opType: 'qc' }),
      posted({ operation: 'Deburring', opType: 'process' }),
    ];
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
  });

  it('does not fire for a started inspection the PERSON put mid-route', () => {
    // 'mid' has logged work but is an ordinary operation; the system's own op
    // ('fi') has none, so adding an op before 'mid' is still allowed. It is the
    // STORED TERMINAL op's started flag that decides, not any QC step's.
    const rows = [
      stored('a1', 1, 'Turning', 'process'),
      stored('mid', 2, 'Final Inspection', 'qc', { started: true }),
      stored('a2', 3, 'Milling', 'process'),
      stored('fi', 4, 'Final Inspection', 'qc'),
    ];
    const proposedAll = [
      posted({ id: 'a1', operation: 'Turning', opType: 'process' }),
      posted({ id: 'mid', operation: 'Final Inspection', opType: 'qc' }),
      posted({ id: 'a2', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (sixth + SEVENTH review round) — A CARD NEEDS AN OPERATION THAT DOES
// WORK, AND THE TWO REFUSALS SAY THE SAME THING ON BOTH PATHS.
//
// Sixth round: the writer's "must keep at least one operation" guard counted the
// list that still carries the system's own Final Inspection, so a payload of ONLY
// that op passed — the card saved with one QC step and no production operation,
// and a QC accept on it credits finished stock for work that was never logged.
//
// Seventh round, two faults in that fix:
//  1. it removed only the ONE generated row, so "at least one op that is not the
//     generated Final Inspection" is not "at least one production operation":
//     delete every real op, then + Add QC Op and pick any QC process other than
//     Final Inspection (DIR, MIR…) and it passed — the card saved as DIR + Final
//     Inspection with nothing producing anything. jcHasProductionOp now asks the
//     real question: is there a `process` or an `outsource` op in here?
//  2. EVERY empty payload got the production-operation wording, including a card
//     that never had a generated Final Inspection (one ending at an outsource
//     step) — the person deleted everything and was told about an inspection that
//     was never there, while the staging path said something different again for
//     the same action. One empty-routing wording and one production-operation
//     wording now, both declared once and used by both paths.
//  3. and it must be GRANDFATHERED. Two live cards (test stack, 2026-10-09) are
//     stored as a single QC op with no production in them at all; an absolute rule
//     refuses every save on those, header-only edits included, which blocks work
//     and protects nothing. So the refusal is on the EDIT that creates the state:
//     stored routing does work AND submitted routing does not
//     (jcEditRemovesLastProductionOp) — the same grandfathering the OSP → QC rule
//     already uses.
//
// No database here: updateJobCardTx needs one, so these cases assert on the same
// expressions the writer evaluates — the real stripStaleGeneratedTerminalQc, then
// withoutOpId by the stored Final Inspection's id, then jcHasProductionOp.
describe('a routing must contain an operation that does work', () => {
  /** The writer's own list: input.ops after the stale strip, minus the stored
   *  generated Final Inspection. */
  const realUserOps = (rows: JcOpEditRow[], proposedAll: JcOpInput[]): JcOpInput[] => {
    const terminal = storedTerminal(rows);
    const userOps = stripStaleGeneratedTerminalQc(proposedAll, {
      recoveryKind: null,
      isStarted: (o) => !!o.id && rows.some((r) => r.id === o.id && r.started),
    });
    return withoutOpId(userOps, terminal?.id ?? null);
  };

  it('reads a payload of ONLY the generated Final Inspection as no production', () => {
    // The row the person is left with after deleting Cutting and Milling.
    const onlyFi = [posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' })];
    expect(onlyFi).toHaveLength(1); // one op in the payload...
    expect(realUserOps(LIVE, onlyFi)).toHaveLength(0); // ...and nothing left of it
    expect(jcHasProductionOp(realUserOps(LIVE, onlyFi))).toBe(false);
  });

  it('THE SEVENTH-ROUND HOLE: a QC step that is not Final Inspection is still not production', () => {
    // Delete every real op, then + Add QC Op → DIR. The old rule counted this as
    // one real operation (it is not the generated Final Inspection) and the card
    // saved as DIR + Final Inspection with no work in it at all.
    const onlyDir = [
      posted({ operation: 'DIR', opType: 'qc' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    const real = realUserOps(LIVE, onlyDir);
    expect(real).toHaveLength(1); // the old rule's answer: "one real op" → saved
    expect(jcHasProductionOp(real)).toBe(false); // the rule's real meaning → refused
  });

  it('counts machining and outsourcing as production, QC as not', () => {
    expect(jcHasProductionOp([posted({ operation: 'Milling', opType: 'process' })])).toBe(true);
    expect(jcHasProductionOp([posted({ operation: 'Plating', opType: 'outsource' })])).toBe(true);
    expect(jcHasProductionOp([posted({ operation: 'MIR', opType: 'qc' })])).toBe(false);
    expect(jcHasProductionOp([])).toBe(false);
  });

  it('leaves an ALL-OUTSOURCE routing legal (send out, receive back)', () => {
    // The vendor does the work, so this is production. ADR-179 credits it when
    // the material comes back; refusing it would block real job-work cards.
    const sentOut = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
    ];
    expect(jcHasProductionOp(realUserOps(LIVE, sentOut))).toBe(true);
    expect(() => assertJcOpsStageable(CODE, LIVE, sentOut, true)).not.toThrow();
  });

  it('leaves production mixed with QC steps legal', () => {
    const mixed = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'MIR', opType: 'qc' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(jcHasProductionOp(realUserOps(LIVE, mixed))).toBe(true);
    expect(() => assertJcOpsStageable(CODE, LIVE, mixed, true)).not.toThrow();
  });

  it('refuses a routing of only the person’s own QC step as well', () => {
    // A card with no generated inspection at all: nothing is stripped, so the old
    // count said "one real operation" and let it save. It still has no work in it,
    // and the STORED routing did have some — so this edit is what creates the
    // harmful state, and it is refused.
    const rows = [stored('a1', 1, 'Turning', 'process'), stored('q1', 2, 'MIR', 'qc')];
    const onlyQc = [posted({ id: 'q1', operation: 'MIR', opType: 'qc' })];
    expect(realUserOps(rows, onlyQc)).toHaveLength(1);
    expect(jcHasProductionOp(realUserOps(rows, onlyQc))).toBe(false);
    expect(() => assertJcOpsStageable(CODE, rows, onlyQc, true)).toThrow(
      jcNoProductionOpMessage(CODE),
    );
  });

  // ---- GRANDFATHERED: refuse the edit that CREATES the state, not the state ---
  //
  // Measured 2026-10-09, read-only, both stacks: IN-JC-26-00029 and
  // IN-JC-26-00030 on the test stack are each a single `qc` op with no
  // recovery_kind; production has none. An absolute rule refuses EVERY save on
  // those two cards — a Remarks or Due Date change included, because the Job Card
  // form always posts the whole routing back. That blocks someone's work and
  // protects nothing: the state is already saved and refusing the edit does not
  // undo it. Same shape as the OSP → QC rule, where a pair already stored side by
  // side stays editable.
  it('THE REGRESSION: a card stored with no production operation still saves', () => {
    // IN-JC-26-00029's shape: one QC op, nothing else, posted straight back —
    // which is what a header-only edit sends. It must go through.
    const qcOnlyCard = [stored('q1', 1, 'MIR', 'qc')];
    expect(jcHasProductionOp(qcOnlyCard)).toBe(false);
    expect(jcEditRemovesLastProductionOp(qcOnlyCard, asPosted(qcOnlyCard))).toBe(false);
    expect(() => assertJcOpsStageable(CODE, qcOnlyCard, asPosted(qcOnlyCard), true)).not.toThrow();
    // ...and it may still be edited within itself (renamed QC step, another QC
    // step added) without the production rule getting in the way.
    const edited = [
      posted({ id: 'q1', operation: 'MCR', opType: 'qc' }),
      posted({ operation: 'DIR', opType: 'qc' }),
    ];
    expect(jcEditRemovesLastProductionOp(qcOnlyCard, edited)).toBe(false);
    expect(() => assertJcOpsStageable(CODE, qcOnlyCard, edited, true)).not.toThrow();
  });

  it('but a card that LOSES its last production operation is still refused', () => {
    // The other direction, which must not loosen: the stored routing does work,
    // the submitted one does not.
    const normalCard = [stored('a1', 1, 'Turning', 'process'), stored('q1', 2, 'MIR', 'qc')];
    const noWorkLeft = [posted({ id: 'q1', operation: 'MIR', opType: 'qc' })];
    expect(jcEditRemovesLastProductionOp(normalCard, noWorkLeft)).toBe(true);
    expect(() => assertJcOpsStageable(CODE, normalCard, noWorkLeft, true)).toThrow(
      jcNoProductionOpMessage(CODE),
    );
    // The review's DIR-only hole is this same shape, and stays refused.
    const dirOnly = [
      posted({ operation: 'DIR', opType: 'qc' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(jcEditRemovesLastProductionOp(LIVE, realUserOps(LIVE, dirOnly))).toBe(true);
  });

  it('an empty payload is still the empty-routing refusal, grandfathered or not', () => {
    // Even on a card that was already production-free: nothing submitted is
    // nothing submitted, and it gets the other wording.
    const qcOnlyCard = [stored('q1', 1, 'MIR', 'qc')];
    expect(() => assertJcOpsStageable(CODE, qcOnlyCard, [], true)).toThrow(
      jcEmptyRoutingMessage(CODE),
    );
  });

  // ---- the TWO wordings, single-sourced -----------------------------------
  it('names what is missing in a routing that has operations but no work', () => {
    expect(jcNoProductionOpMessage(CODE)).toBe(
      `${CODE} must keep at least one production operation — a routing of only inspection steps cannot be saved.`,
    );
  });

  it('says something DIFFERENT for a routing with nothing in it at all', () => {
    expect(jcEmptyRoutingMessage(CODE)).toBe(
      `${CODE} must keep at least one operation — it cannot be saved with an empty routing.`,
    );
    expect(jcEmptyRoutingMessage(CODE)).not.toBe(jcNoProductionOpMessage(CODE));
  });

  it('the staging path picks the SAME two messages the writer picks', () => {
    // Nothing submitted → the empty-routing wording. A person who deleted every
    // row on a card that has no generated inspection must not be told about one.
    expect(() => assertJcOpsStageable(CODE, LIVE, [], true)).toThrow(jcEmptyRoutingMessage(CODE));
    const noFiCard = [
      stored('a1', 1, 'Turning', 'process'),
      stored('o1', 2, 'Plating', 'outsource'),
    ];
    expect(() => assertJcOpsStageable(CODE, noFiCard, [], true)).toThrow(
      jcEmptyRoutingMessage(CODE),
    );
    // Operations submitted, but none of them does any work → the other wording.
    const onlyFi = [posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' })];
    expect(() => assertJcOpsStageable(CODE, LIVE, onlyFi, true)).toThrow(
      jcNoProductionOpMessage(CODE),
    );
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (sixth review round) — THE OSP → QC RULE IS ASKED AT STAGING TOO.
//
// "A non-TPI QC op may not sit directly after an outsource step" (ADR-179) was
// run by the writer and not by the staging pre-check, so the pair could be
// staged and was then refused at approval — rolling back the whole approval and
// leaving the approver an error they cannot clear, the same class as every other
// refusal in this file. The pre-check now calls the SAME helper the writer calls
// (assertNoQcDirectlyAfterOutsource) with the SAME two inputs:
//   - the submitted routing after stripStaleGeneratedTerminalQc — never the raw
//     payload, which would be STRICTER than the writer (see the third test);
//   - grandfatheredOspQcPairs over the STORED routing, so a Job Card that is
//     already saved in that shape stays editable.
describe('assertJcOpsStageable — the OSP → QC rule, same answer as the writer', () => {
  it('refuses a QC op placed directly after an outsource op, in the rule’s own words', () => {
    // A new OSP step and a new QC step added side by side before the Final
    // Inspection. The inspection is un-started, so none of the started-op
    // refusals apply — this is the OSP → QC rule and nothing else.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Plating', opType: 'outsource' }),
      posted({ operation: 'MIR', opType: 'qc' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    // The writer's own wording, built by the shared rule rather than retyped
    // here, so the two can never drift apart in this test either.
    const expected = qcAfterOutsourceError(proposedAll);
    expect(expected).not.toBeNull();
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).toThrow(ValidationError);
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).toThrow(expected!);
  });

  it('still allows a routing whose OSP → QC pair is already STORED that way', () => {
    // THE TEST THAT MATTERS. Old Job Cards exist with this adjacency already
    // saved; refusing them would block real work on cards nobody can re-route.
    // grandfatheredOspQcPairs over the stored rows is what keeps them editable,
    // and the pre-check reads those rows from `currentAll` — the same input the
    // writer passes.
    const rows = [
      stored('o1', 1, 'Plating', 'outsource'),
      stored('q1', 2, 'MIR', 'qc'), // saved directly after the OSP step
      stored('m1', 3, 'Milling', 'process'),
    ];
    // Posted back with one ordinary edit on the LAST op, nowhere near the pair.
    const proposedAll = [
      posted({ id: 'o1', operation: 'Plating', opType: 'outsource' }),
      posted({ id: 'q1', operation: 'MIR', opType: 'qc' }),
      posted({ id: 'm1', operation: 'Finish Milling', opType: 'process' }),
    ];
    // Proof the case is real: without the grandfathering this routing IS a
    // violation...
    expect(qcAfterOutsourceError(proposedAll)).not.toBeNull();
    // ...and with the stored pairs allowed, it is clean — on both paths.
    expect(qcAfterOutsourceError(proposedAll, grandfatheredOspQcPairs(rows))).toBeNull();
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
  });

  it('is never STRICTER than the writer: the stale inspection is stripped first', () => {
    // The trap. The person retypes the last real op to OSP and the browser still
    // sends the generated Final Inspection, so the RAW payload reads
    // Plating(OSP) → Final Inspection(QC) — a violation. The writer never sees it:
    // stripStaleGeneratedTerminalQc drops that inspection (ADR-179 gives an
    // outsource-last routing no terminal QC), so the writer accepts the save.
    // Judging the raw payload here would refuse an edit the writer allows, which
    // is worse than the hole this closed.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(qcAfterOutsourceError(proposedAll)).not.toBeNull(); // raw payload: violation
    expect(
      stripStaleGeneratedTerminalQc(proposedAll, { recoveryKind: null }).map((o) => o.id),
    ).toEqual(['c1', 'm1']); // what the writer actually judges
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).not.toThrow();
  });

  it('allows TPI directly after an outsource step (ADR-179)', () => {
    // TPI IS the third-party inspection of the vendor's work, so it is the one
    // QC the rule lets through. Carried by the same shared helper.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
      posted({ operation: 'Plating', opType: 'outsource' }),
      posted({ operation: 'TPI', opType: 'qc' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, LIVE, proposedAll, true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (eighth review round) — EVERY APPROVABLE SUBSET MUST BE SAVEABLE.
//
// THE GENERAL DEFECT. Approval is per box: the approver may approve some boxes
// and reject others. So the staging contract is not "the whole proposal is a
// saveable routing" — it is "every approvable subset of it is". Three rules only
// judged the complete proposal, and each of them turned a merely-undesirable
// save into a DEAD APPROVAL: the boxes staged, the approver took one of them,
// the writer threw inside applyEdit, the whole decision rolled back, the request
// stayed pending and the only escape was to reject everything.
//
// THE ONE FIX, THREE TIMES. worstApprovableSubset(proposedAll) = the proposal
// with every ADDED operation stripped and everything else (removals, retypes,
// attribute edits) applied — i.e. keep only the ops that carry an id, because an
// added op has none. That is a decision the approver can really take, and it is
// the worst one for all three rules. Nothing a proposal needs may depend on an
// added operation.
//
// STAGING ONLY. The writer still judges the routing it is about to write, which
// with the gate OFF is the whole proposal — tightening it there would refuse
// legitimate direct saves. Each refusal below is therefore paired with proof
// that the SAME edit still answers "allowed" on the writer's own expressions.
describe('assertJcOpsStageable — every approvable subset, not just the proposal', () => {
  /** What the WRITER judges, with no database: input.ops after the real stale
   *  strip (updateJobCardTx's `userOps`), and that list without the stored
   *  generated Final Inspection (its `realUserOps`). */
  const writerSees = (rows: JcOpEditRow[], proposedAll: JcOpInput[]) => {
    const terminal = terminalQcOp(rows) ?? null;
    const userOps = stripStaleGeneratedTerminalQc(proposedAll, {
      recoveryKind: null,
      isStarted: (o) => !!o.id && rows.some((r) => r.id === o.id && r.started),
    });
    return { userOps, realUserOps: withoutOpId(userOps, terminal?.id ?? null) };
  };

  it('keeps only the operations that carry an id', () => {
    // The helper itself: an added op has no id, so "strip the adds" needs no diff
    // against the stored routing and cannot drift out of step with one.
    const proposedAll = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(worstApprovableSubset(proposedAll).map((o) => o.id)).toEqual(['c1', 'fi']);
    // A retype is an attribute of a KEPT op, so it stays applied in the subset.
    const retyped = [posted({ id: 'c1', operation: 'Cutting', opType: 'process' })];
    expect(worstApprovableSubset(retyped)[0]!.opType).toBe('process');
  });

  // ---- RULE 1: the production operation -----------------------------------
  const PROD_CARD = [
    stored('t1', 1, 'Turning', 'process'),
    stored('fi', 2, 'Final Inspection', 'qc'),
  ];
  /** Remove Turning, add a new process op in its place. The whole proposal still
   *  does work — which is exactly why this used to stage. */
  const SWAP_THE_ONLY_PRODUCTION_OP = [
    posted({ operation: 'Grinding', opType: 'process' }),
    posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
  ];

  it('refuses a remove-plus-add that leaves the SUBSET with no production operation', () => {
    // Proof the proposal looks clean: the old check asked only this.
    expect(jcHasProductionOp(writerSees(PROD_CARD, SWAP_THE_ONLY_PRODUCTION_OP).realUserOps)).toBe(
      true,
    );
    // ...and proof of what the approver can actually build: approve the removal,
    // reject the add, and only the Final Inspection is left.
    expect(worstApprovableSubset(SWAP_THE_ONLY_PRODUCTION_OP).map((o) => o.id)).toEqual(['fi']);
    expect(() => assertJcOpsStageable(CODE, PROD_CARD, SWAP_THE_ONLY_PRODUCTION_OP, true)).toThrow(
      ValidationError,
    );
    expect(() => assertJcOpsStageable(CODE, PROD_CARD, SWAP_THE_ONLY_PRODUCTION_OP, true)).toThrow(
      jcNoProductionOpMessage(CODE),
    );
  });

  it('...but the same edit is still allowed with the gate OFF (the writer is untouched)', () => {
    // With no boxes there is no subset: the whole proposal IS the outcome, and it
    // keeps a production operation. The writer's own two questions both pass.
    const { userOps, realUserOps } = writerSees(PROD_CARD, SWAP_THE_ONLY_PRODUCTION_OP);
    expect(userOps).not.toHaveLength(0);
    expect(jcEditRemovesLastProductionOp(PROD_CARD, realUserOps)).toBe(false);
  });

  it('still allows an edit that only ADDS an operation', () => {
    const addOnly = [
      posted({ id: 't1', operation: 'Turning', opType: 'process' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, PROD_CARD, addOnly, true)).not.toThrow();
  });

  it('still allows an ATTRIBUTE-only edit', () => {
    const attrOnly = [
      { ...posted({ id: 't1', operation: 'Turning', opType: 'process' }), cycleTimeMin: 7 },
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, PROD_CARD, attrOnly, true)).not.toThrow();
  });

  it('still allows a removal that leaves production intact', () => {
    const twoOps = [
      stored('t1', 1, 'Turning', 'process'),
      stored('m1', 2, 'Milling', 'process'),
      stored('fi', 3, 'Final Inspection', 'qc'),
    ];
    const dropMilling = [
      posted({ id: 't1', operation: 'Turning', opType: 'process' }),
      posted({ id: 'fi', operation: 'Final Inspection', opType: 'qc' }),
    ];
    // The subset keeps Turning, so every decision the approver can take still
    // leaves work on the card.
    expect(jcHasProductionOp(worstApprovableSubset(dropMilling))).toBe(true);
    expect(() => assertJcOpsStageable(CODE, twoOps, dropMilling, true)).not.toThrow();
  });

  // ---- RULE 2: the empty routing ------------------------------------------
  const TWO_OP_CARD = [
    stored('t1', 1, 'Turning', 'process'),
    stored('m1', 2, 'Milling', 'process'),
  ];
  /** Remove BOTH stored ops and add one. Approve the two removals, reject the
   *  add, and the card is left with no routing at all. */
  const SWAP_EVERY_OP = [posted({ operation: 'Grinding', opType: 'process' })];

  it('refuses a remove-remove-add whose SUBSET is an empty routing', () => {
    expect(SWAP_EVERY_OP).not.toHaveLength(0); // the payload itself is not empty
    expect(worstApprovableSubset(SWAP_EVERY_OP)).toHaveLength(0); // what can be left
    expect(() => assertJcOpsStageable(CODE, TWO_OP_CARD, SWAP_EVERY_OP, true)).toThrow(
      jcEmptyRoutingMessage(CODE),
    );
    // The two wordings are NOT conflated: this is the empty-routing one, not the
    // production-operation one.
    expect(() => assertJcOpsStageable(CODE, TWO_OP_CARD, SWAP_EVERY_OP, true)).not.toThrow(
      jcNoProductionOpMessage(CODE),
    );
  });

  it('...but the same edit is still allowed with the gate OFF', () => {
    const { userOps, realUserOps } = writerSees(TWO_OP_CARD, SWAP_EVERY_OP);
    expect(userOps).toHaveLength(1); // the writer's "nothing submitted" test passes
    expect(jcEditRemovesLastProductionOp(TWO_OP_CARD, realUserOps)).toBe(false);
  });

  it('a genuinely empty payload still gets the empty-routing wording by its own test', () => {
    // Unchanged, and still decided on the RAW payload: it is a different mistake
    // from "everything submitted was an addition", and it keeps its own route
    // through the function.
    expect(() => assertJcOpsStageable(CODE, TWO_OP_CARD, [], true)).toThrow(
      jcEmptyRoutingMessage(CODE),
    );
  });

  it('still allows the FIRST operation on a card stored with an empty routing', () => {
    // An all-adds edit on a card that has no operations: its subset is empty by
    // definition, and refusing it would block the only way to give such a card a
    // routing. The writer guards the same case with `existing.length > 0`.
    expect(() => assertJcOpsStageable(CODE, [], SWAP_EVERY_OP, true)).not.toThrow();
  });

  // ---- RULE 3: no QC directly after an outsource step ----------------------
  const OSP_QC_CARD = [stored('t1', 1, 'Turning', 'process'), stored('d1', 2, 'DIR', 'qc')];
  /** Retype Turning to outsource AND insert a machining op between it and DIR.
   *  The full proposal reads Turning(OSP) → Milling → DIR, which is clean. */
  const RETYPE_PLUS_INSERT = [
    posted({ id: 't1', operation: 'Turning', opType: 'outsource' }),
    posted({ operation: 'Milling', opType: 'process' }),
    posted({ id: 'd1', operation: 'DIR', opType: 'qc' }),
  ];

  it('refuses a retype whose SUBSET puts a QC step straight after an outsource step', () => {
    const pairs = grandfatheredOspQcPairs(OSP_QC_CARD);
    // The proposal is clean — the insertion separates the pair...
    expect(qcAfterOutsourceError(RETYPE_PLUS_INSERT, pairs)).toBeNull();
    // ...and approving the retype alone is not.
    const subset = worstApprovableSubset(RETYPE_PLUS_INSERT);
    expect(subset.map((o) => o.opType)).toEqual(['outsource', 'qc']);
    const expected = qcAfterOutsourceError(subset, pairs);
    expect(expected).not.toBeNull();
    expect(() => assertJcOpsStageable(CODE, OSP_QC_CARD, RETYPE_PLUS_INSERT, true)).toThrow(
      ValidationError,
    );
    expect(() => assertJcOpsStageable(CODE, OSP_QC_CARD, RETYPE_PLUS_INSERT, true)).toThrow(
      expected!,
    );
  });

  it('...but the same edit is still allowed with the gate OFF', () => {
    // The writer judges its own `userOps` — the whole proposal after the stale
    // strip — and that routing has no OSP → QC pair, so a direct save goes
    // through exactly as it did before.
    const { userOps } = writerSees(OSP_QC_CARD, RETYPE_PLUS_INSERT);
    expect(qcAfterOutsourceError(userOps, grandfatheredOspQcPairs(OSP_QC_CARD))).toBeNull();
  });

  it('runs the subset through the SAME grandfathering, so an old pair stays editable', () => {
    // The pair is already stored side by side, so neither the proposal nor its
    // subset may be refused for it — even with an operation added elsewhere.
    const rows = [
      stored('o1', 1, 'Plating', 'outsource'),
      stored('q1', 2, 'MIR', 'qc'),
      stored('m1', 3, 'Milling', 'process'),
    ];
    const proposedAll = [
      posted({ id: 'o1', operation: 'Plating', opType: 'outsource' }),
      posted({ id: 'q1', operation: 'MIR', opType: 'qc' }),
      posted({ operation: 'Deburring', opType: 'process' }),
      posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
    ];
    expect(qcAfterOutsourceError(worstApprovableSubset(proposedAll))).not.toBeNull(); // real pair
    expect(() => assertJcOpsStageable(CODE, rows, proposedAll, true)).not.toThrow();
  });

  it('still refuses a QC step ADDED directly after an outsource step', () => {
    // The proposal is checked as well as the subset: an added QC op exists only
    // in the proposal, and the approver may well approve that box.
    const proposedAll = [
      posted({ id: 't1', operation: 'Turning', opType: 'outsource' }),
      posted({ operation: 'MIR', opType: 'qc' }),
      posted({ id: 'd1', operation: 'DIR', opType: 'qc' }),
    ];
    expect(() => assertJcOpsStageable(CODE, OSP_QC_CARD, proposedAll, true)).toThrow(
      ValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// ADR-227 (eighth round, fix 4) — THE HAND-DELETE GUARD, WALKED AROUND BY
// DROPPING THE ID.
//
// assertTerminalQcUnchanged finds the stored Final Inspection by id. A payload
// that drops that id but still carries a Final-Inspection-named `qc` op was read
// as "absent and not needed": the routing ends in `qc`, so Rule B
// (needsDefaultQcOp) says no inspection is owed and the check passed. The writer
// then inserted the id-less row and soft-deleted the stored one — the stored
// inspection replaced by a brand-new row with a NEW id, which is precisely the
// hole the doc comment claims is closed.
//
// Not reachable from the Edit screen (its rows always carry their ids). Any
// other API client reaches it, which is the whole reason it needs a server guard.
describe('assertTerminalQcUnchanged — a REPLACED Final Inspection is a removal', () => {
  const REPLACED = [
    posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
    posted({ id: 'm1', operation: 'Milling', opType: 'process' }),
    posted({ operation: 'Final Inspection', opType: 'qc' }), // no id — a NEW row
  ];

  it('refuses it, and proves Rule B alone would have let it through', () => {
    // Why the old check passed: the routing already ends in `qc`, so no default
    // inspection is owed and the "deleted by hand" branch returned clean.
    expect(needsDefaultQcOp(REPLACED, {})).toBe(false);
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), REPLACED)).toThrow(
      ValidationError,
    );
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), REPLACED)).toThrow(
      TERMINAL_QC_REPLACED_MESSAGE,
    );
  });

  it('says something different from the plain hand-deletion', () => {
    // There IS a Final Inspection in this payload, so "cannot be removed" would
    // read as untrue to whoever sent it.
    expect(TERMINAL_QC_REPLACED_MESSAGE).not.toBe(
      'Final Inspection is added by the system and cannot be removed here.',
    );
  });

  it('is refused at staging too, so it never becomes an approval box', () => {
    expect(() => assertJcOpsStageable(CODE, LIVE, REPLACED, true)).toThrow(
      TERMINAL_QC_REPLACED_MESSAGE,
    );
  });

  it('still allows the LEGITIMATE absence — the routing now ends at an outsource step', () => {
    // ADR-179: an outsource-last routing is owed no terminal QC, so the browser
    // stops sending the stale one and the writer soft-deletes it. Nothing here
    // may touch that.
    const endsAtOsp = [
      posted({ id: 'c1', operation: 'Cutting', opType: 'outsource' }),
      posted({ id: 'm1', operation: 'Plating', opType: 'outsource' }),
    ];
    expect(() => assertTerminalQcUnchanged(storedTerminal(LIVE), endsAtOsp)).not.toThrow();
  });

  it('ignores an id-less Final Inspection on a card that has no generated one', () => {
    // No stored terminal inspection = nothing to protect. A Final Inspection the
    // person adds themselves is an ordinary operation with its own box.
    const noTerminalCard = [stored('t1', 1, 'Turning', 'process')];
    const addsOwnFi = [
      posted({ id: 't1', operation: 'Turning', opType: 'process' }),
      posted({ operation: 'Final Inspection', opType: 'qc' }),
    ];
    expect(storedTerminal(noTerminalCard)).toBeNull();
    expect(() =>
      assertTerminalQcUnchanged(storedTerminal(noTerminalCard), addsOwnFi),
    ).not.toThrow();
    expect(() => assertJcOpsStageable(CODE, noTerminalCard, addsOwnFi, true)).not.toThrow();
  });
});
