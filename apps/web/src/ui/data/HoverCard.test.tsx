import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from './HoverCard';

function inCell() {
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <HoverCard label="Breakdown" card={<span>Waiting QC 8</span>}>
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

  it('opens on keyboard focus and closes on Esc', () => {
    const trigger = inCell();
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
