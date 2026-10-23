// ADR-249 Step B1 — the Job Card "live" rule for edit approval, and the
// complete / closed routing freeze that the writer and the staging pre-check
// now share. Pure, no database. Run via `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it } from 'vitest';
import {
  JC_FINISHED_OPS_FROZEN_MESSAGE,
  jcFinishedRoutingChanged,
  jcMachineChangeGatedMessage,
  jobCardIsFinished,
  jobCardIsLive,
} from './jc-op-edit';

describe('jobCardIsLive — every card not deleted goes for approval (ADR-249 B1)', () => {
  it('an open card is live', () => {
    expect(jobCardIsLive({ deletedAt: null })).toBe(true);
  });
  it('a complete or closed card is live too (it used to edit directly)', () => {
    // The machine-change gates pass the row they read (closedAt + status, with
    // deleted cards already filtered out in SQL) — that row is live.
    const finishedRow = { closedAt: new Date(), status: 'closed' };
    expect(jobCardIsLive(finishedRow)).toBe(true);
    expect(jobCardIsLive({ closedAt: null, status: 'complete' })).toBe(true);
  });
  it('a row read with deleted_at filtered in SQL (no deletedAt key) is live', () => {
    expect(jobCardIsLive({})).toBe(true);
  });
  it('a deleted card is not live', () => {
    expect(jobCardIsLive({ deletedAt: new Date('2026-10-01') })).toBe(false);
    expect(jobCardIsLive({ deletedAt: '2026-10-01T00:00:00Z' })).toBe(false);
  });
});

describe('jobCardIsFinished — the writer freeze condition', () => {
  it.each([
    [{ closedAt: null, status: 'in_progress' }, false],
    [{ closedAt: null, status: 'no_ops' }, false],
    [{ closedAt: null, status: 'complete' }, true],
    [{ closedAt: null, status: 'closed' }, true],
    [{ closedAt: new Date(), status: 'in_progress' }, true],
  ])('%o → %s', (card, finished) => {
    expect(jobCardIsFinished(card)).toBe(finished);
  });
});

describe('jcFinishedRoutingChanged — structure only, attributes are free', () => {
  const stored = [
    { id: 'a', opSeq: 1, opType: 'process' },
    { id: 'b', opSeq: 2, opType: 'process' },
    { id: 'fi', opSeq: 3, opType: 'qc' },
  ];
  it('the same routing resent is not a change', () => {
    expect(
      jcFinishedRoutingChanged(stored, [
        { id: 'a', opType: 'process' },
        { id: 'b', opType: 'process' },
        { id: 'fi', opType: 'qc' },
      ]),
    ).toBe(false);
  });
  it('an added operation is a change', () => {
    expect(
      jcFinishedRoutingChanged(stored, [
        { id: 'a', opType: 'process' },
        { id: 'b', opType: 'process' },
        { opType: 'process' },
        { id: 'fi', opType: 'qc' },
      ]),
    ).toBe(true);
  });
  it('a removed operation is a change', () => {
    expect(
      jcFinishedRoutingChanged(stored, [
        { id: 'a', opType: 'process' },
        { id: 'fi', opType: 'qc' },
      ]),
    ).toBe(true);
  });
  it('a moved operation is a change', () => {
    expect(
      jcFinishedRoutingChanged(stored, [
        { id: 'b', opType: 'process' },
        { id: 'a', opType: 'process' },
        { id: 'fi', opType: 'qc' },
      ]),
    ).toBe(true);
  });
  it('a retyped operation is a change', () => {
    expect(
      jcFinishedRoutingChanged(stored, [
        { id: 'a', opType: 'process' },
        { id: 'b', opType: 'outsource' },
        { id: 'fi', opType: 'qc' },
      ]),
    ).toBe(true);
  });
  it('an id that is not on the stored routing counts as an add', () => {
    expect(
      jcFinishedRoutingChanged(stored, [
        { id: 'a', opType: 'process' },
        { id: 'zz', opType: 'process' },
        { id: 'fi', opType: 'qc' },
      ]),
    ).toBe(true);
  });
  it('keeps the writer wording', () => {
    expect(JC_FINISHED_OPS_FROZEN_MESSAGE).toBe(
      'This JC is Completed, so its operations cannot change. Reopen it first.',
    );
  });
});

describe('jcMachineChangeGatedMessage — the direct machine-change refusal', () => {
  it('an open card keeps the existing wording', () => {
    expect(jcMachineChangeGatedMessage({ closedAt: null, status: 'in_progress' })).toBe(
      "Changing an operation's machine isn't available while Document Edit Approval is on — " +
        'open the Job Card and edit it there, so the change goes for approval.',
    );
  });
  it('a complete / closed card is named as such', () => {
    for (const card of [
      { closedAt: null, status: 'complete' },
      { closedAt: new Date(), status: 'in_progress' },
    ]) {
      expect(jcMachineChangeGatedMessage(card)).toMatch(/Completed or Closed/);
    }
  });
});
