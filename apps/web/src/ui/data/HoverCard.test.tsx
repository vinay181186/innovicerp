import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from './HoverCard';

function inCell(onRow = vi.fn()) {
  render(
    <table>
      <tbody>
        <tr onClick={onRow}>
          <td>
            <HoverCard title="Breakdown" card={<span>Waiting QC 8</span>}>
              Inspection
            </HoverCard>
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return screen.getByText('Inspection');
}

describe('HoverCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens after the hover delay, outside the table cell, and closes after leaving', () => {
    const trigger = inCell();
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => void vi.advanceTimersByTime(150));
    const card = screen.getByRole('tooltip');
    expect(card.textContent).toContain('Waiting QC 8');
    // Portalled to <body>, so the clipping <td> never contains it.
    expect(card.closest('td')).toBeNull();
    fireEvent.mouseLeave(trigger);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stays open while the pointer moves onto the card', () => {
    const trigger = inCell();
    fireEvent.mouseEnter(trigger);
    act(() => void vi.advanceTimersByTime(150));
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('closes on Esc without letting a dialog close, and a click inside never opens the row', () => {
    const onRow = vi.fn();
    const trigger = inCell(onRow);
    fireEvent.mouseEnter(trigger);
    act(() => void vi.advanceTimersByTime(150));
    fireEvent.click(screen.getByRole('tooltip'));
    expect(onRow).not.toHaveBeenCalled();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
