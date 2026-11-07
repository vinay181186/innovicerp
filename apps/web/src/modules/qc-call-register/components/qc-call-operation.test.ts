import { describe, expect, it } from 'vitest';

import type { StageStat } from './qc-sheet';
import {
  NO_QC_FILTER,
  QC_REGISTER_STAGE_LABELS,
  qcChoiceOptions,
  qcChoiceValue,
  qcFilterNote,
  withChoice,
  withStage,
} from './qc-call-operation';

const stat: StageStat = { count: 2, pcsPending: 0, done: 0, doneCapped: false };
const types = { purchase: stat, party_grn: stat, job_work_return: stat, nc_return: stat };
const ops = [{ name: 'DIR', count: 3 }];
const values = (f: typeof NO_QC_FILTER): string[] =>
  qcChoiceOptions(f, ops, types).map((o) => o.value);

describe('QC register filters (ADR-286)', () => {
  it('reads the two stage names', () => {
    expect(QC_REGISTER_STAGE_LABELS).toEqual({ incoming: 'Incoming', process: 'In-Process' });
  });

  it('All stages lists operations first, then the four types', () => {
    expect(values(NO_QC_FILTER)).toEqual([
      'op:DIR',
      'type:purchase',
      'type:party_grn',
      'type:job_work_return',
      'type:nc_return',
    ]);
  });

  it('each stage lists only its own choices', () => {
    expect(values(withStage(NO_QC_FILTER, 'process'))).toEqual(['op:DIR']);
    expect(values(withStage(NO_QC_FILTER, 'incoming'))).not.toContain('op:DIR');
  });

  it('a pick sets its stage and clears the other kind', () => {
    const op = withChoice(NO_QC_FILTER, 'op:DIR');
    expect(op).toEqual({ stage: 'process', grnType: null, operation: 'DIR' });
    expect(withChoice(op, 'type:nc_return')).toEqual({
      stage: 'incoming',
      grnType: 'nc_return',
      operation: null,
    });
  });

  it('All Operations clears the pick and keeps the stage', () => {
    expect(withChoice(withChoice(NO_QC_FILTER, 'op:DIR'), '')).toEqual({
      stage: 'process',
      grnType: null,
      operation: null,
    });
  });

  it('a stage change clears a pick it no longer lists', () => {
    const op = withChoice(NO_QC_FILTER, 'op:DIR');
    expect(withStage(op, 'incoming').operation).toBeNull();
    expect(withStage(op, null).operation).toBe('DIR');
    const type = withChoice(NO_QC_FILTER, 'type:purchase');
    expect(withStage(type, 'process').grnType).toBeNull();
  });

  it('a chosen operation with no calls left stays listed at (0)', () => {
    const f = withChoice(NO_QC_FILTER, 'op:MIR');
    const options = qcChoiceOptions(f, ops, types);
    expect(options).toContainEqual({ value: 'op:MIR', label: 'MIR (0)' });
    expect(qcChoiceValue(f)).toBe('op:MIR');
  });

  it('a name holding a colon survives the round trip', () => {
    expect(withChoice(NO_QC_FILTER, 'op:DIR: stage 2').operation).toBe('DIR: stage 2');
  });

  it('the note names stage and pick', () => {
    expect(qcFilterNote(withChoice(NO_QC_FILTER, 'op:DIR'))).toBe('In-Process · DIR');
    expect(qcFilterNote(NO_QC_FILTER)).toBeNull();
  });
});
