import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_OWN_SAVE_GRACE_MS } from '@/lib/live-updates/constants';

const info = vi.fn();
vi.mock('@/ui/feedback', () => ({ useToast: () => ({ info }) }));

// The record watch is driven by hand: `ring()` is "someone saved this record".
let ring: () => void = () => undefined;
vi.mock('@/lib/live-updates/live-updates-provider', async () => {
  const react = await import('react');
  return {
    useLiveRecordWatch: () => {
      const [changedByOther, set] = react.useState(false);
      ring = () => set(true);
      return { changedByOther, acknowledge: () => set(false) };
    },
  };
});

const { useLiveChangeNotice } = await import('./use-live-change-notice');

describe('useLiveChangeNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    info.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const render = (saving: boolean) =>
    renderHook(({ s }) => useLiveChangeNotice('sales_orders', 'so-1', 'Sales Order', s), {
      initialProps: { s: saving },
    });

  it('announces a change by someone else', () => {
    render(false);
    act(() => ring());
    expect(info).toHaveBeenCalledWith(
      'Someone else just changed this Sales Order. Your entry is safe — keep going.',
    );
  });

  it('stays silent about the echo of our own save, during and just after it', () => {
    const { rerender } = render(true);
    act(() => ring()); // echo arrives while the save is still in flight
    expect(info).not.toHaveBeenCalled();

    rerender({ s: false });
    act(() => {
      vi.advanceTimersByTime(LIVE_OWN_SAVE_GRACE_MS - 1);
      ring(); // echo arrives just after the save answered
    });
    expect(info).not.toHaveBeenCalled();
  });

  it('announces again once the grace after our save has passed', () => {
    const { rerender } = render(true);
    rerender({ s: false });
    act(() => {
      vi.advanceTimersByTime(LIVE_OWN_SAVE_GRACE_MS);
      ring();
    });
    expect(info).toHaveBeenCalledTimes(1);
  });
});
