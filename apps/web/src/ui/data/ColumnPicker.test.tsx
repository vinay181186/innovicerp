import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColumnPicker, type PickerColumn } from './ColumnPicker';

// ADR-285 — Created On / Created Time keep a working tick; ▲▼ and 📌 stay off.
const COLUMNS: PickerColumn[] = [
  { id: 'sr_no', label: 'Sr No', lead: true },
  { id: 'so_no', label: 'SO No.', lead: true },
  { id: 'created_on', label: 'Created On', lead: true, hideable: true },
  { id: 'created_time', label: 'Created Time', lead: true, hideable: true },
  { id: 'jc_no', label: 'JC No.' },
  { id: 'qty', label: 'Qty' },
];
const ORDER = COLUMNS.map((c) => c.id);

function open(hidden: string[], lockedCount: number) {
  const onOp = vi.fn();
  render(
    <ColumnPicker
      columns={COLUMNS}
      layout={{ order: ORDER, pins: [], hidden }}
      firstId="sr_no"
      lockedCount={lockedCount}
      dropped={[]}
      flash={[]}
      canPin={() => true}
      onOp={onOp}
      onToast={vi.fn()}
      onClose={vi.fn()}
      popRef={createRef<HTMLDivElement>()}
    />,
  );
  return onOp;
}

const tick = (name: RegExp) => screen.getByRole<HTMLInputElement>('checkbox', { name });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

describe('ColumnPicker — hideable lead columns (ADR-285)', () => {
  it('the tick hides Created Time; ▲▼ and pin stay off; other lead ticks stay off', () => {
    const onOp = open([], 4);
    expect(tick(/Created Time/).disabled).toBe(false);
    expect(tick(/Created On/).disabled).toBe(false);
    expect(tick(/SO No\./).disabled).toBe(true);
    expect(tick(/Sr No/).disabled).toBe(true);
    expect(button('Move Created Time left').disabled).toBe(true);
    expect(button('Move Created Time right').disabled).toBe(true);
    expect(button('Unpin Created Time').disabled).toBe(true);
    expect(button('Unpin Created Time').title).toBe('Fixed column — cannot be pinned');
    fireEvent.click(tick(/Created Time/));
    expect(onOp).toHaveBeenCalledWith({ type: 'hide', id: 'created_time' });
  });

  it('while hidden it sits under HIDDEN BY YOU, tick on, no move, no pin on offer', () => {
    const onOp = open(['created_time'], 3);
    screen.getByText('HIDDEN BY YOU');
    expect(tick(/Created Time/).checked).toBe(false);
    expect(tick(/Created Time/).disabled).toBe(false);
    expect(button('Move Created Time left').disabled).toBe(true);
    expect(button('Pin Created Time').disabled).toBe(true);
    expect(button('Pin Created Time').title).toBe('Fixed column — cannot be pinned');
    fireEvent.click(tick(/Created Time/));
    expect(onOp).toHaveBeenCalledWith({ type: 'show', id: 'created_time' });
  });

  it('with Created Time hidden the first movable column cannot go left but the next can', () => {
    open(['created_time'], 3);
    expect(button('Move JC No. left').disabled).toBe(true);
    expect(button('Move JC No. right').disabled).toBe(false);
    expect(button('Move Qty left').disabled).toBe(false);
  });
});
