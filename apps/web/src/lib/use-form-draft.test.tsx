// ADR-313 — form drafts and remembered view state survive leaving the page.
import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFormDraft, FORM_DRAFT_PREFIX } from './use-form-draft';
import { usePersistentState, oneOf } from './use-persistent-state';

vi.mock('./session', () => ({ useSession: () => ({ data: { id: 'u1' } }) }));

const KEY = `${FORM_DRAFT_PREFIX}u1:po-edit:1`;
type V = { qty: number; note: string };

function mount(initial: { values: V; version?: string | undefined; apply?: (v: V) => void }) {
  const apply = initial.apply ?? vi.fn();
  const hook = renderHook(
    (p: { values: V; version?: string | undefined }) =>
      useFormDraft<V>({
        key: 'po-edit:1',
        ready: true,
        values: p.values,
        apply,
        version: p.version,
      }),
    { initialProps: { values: initial.values, version: initial.version } },
  );
  return { ...hook, apply };
}

describe('useFormDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps nothing for a form nobody touched', () => {
    const { rerender } = mount({ values: { qty: 1, note: '' }, version: 'v1' });
    rerender({ values: { qty: 1, note: 'default filled by the form' }, version: 'v1' });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps what the user typed, and brings it back on the next visit', () => {
    const first = mount({ values: { qty: 1, note: '' }, version: 'v1' });
    fireEvent.input(document.body);
    first.rerender({ values: { qty: 7, note: 'rush' }, version: 'v1' });
    expect(sessionStorage.getItem(KEY)).toContain('rush');
    first.unmount();

    const second = mount({ values: { qty: 1, note: '' }, version: 'v1' });
    expect(second.apply).toHaveBeenCalledWith({ qty: 7, note: 'rush' });
    expect(second.result.current.band).not.toBeNull();
  });

  it('does NOT bring a draft back over a record someone saved since (§20.4)', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        version: 'v1',
        savedAt: 1,
        hadFiles: false,
        values: { qty: 9, note: 'old' },
      }),
    );
    const { apply, result } = mount({ values: { qty: 1, note: '' }, version: 'v2' });
    expect(apply).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(result.current.band).not.toBeNull();
  });

  it('clear() forgets the draft and an unmount right after does not write it again', () => {
    const { rerender, result, unmount } = mount({ values: { qty: 1, note: '' }, version: 'v1' });
    fireEvent.input(document.body);
    rerender({ values: { qty: 3, note: 'x' }, version: 'v1' });
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    act(() => result.current.clear());
    rerender({ values: { qty: 3, note: 'x' }, version: 'v1' });
    unmount();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('drops files instead of storing them', () => {
    const { rerender } = mount({ values: { qty: 1, note: '' }, version: undefined });
    fireEvent.input(document.body);
    rerender({
      values: { qty: 2, note: new Blob(['x']) as unknown as string },
      version: undefined,
    });
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as { hadFiles: boolean };
    expect(stored.hadFiles).toBe(true);
  });
});

describe('usePersistentState', () => {
  beforeEach(() => sessionStorage.clear());

  it('remembers the choice for the same key and re-reads for another key', () => {
    const a = renderHook(({ k }) => usePersistentState(k, 'ops', oneOf(['ops', 'history'])), {
      initialProps: { k: 'jc:1:tab' },
    });
    act(() => a.result.current[1]('history'));
    a.unmount();
    const b = renderHook(({ k }) => usePersistentState(k, 'ops', oneOf(['ops', 'history'])), {
      initialProps: { k: 'jc:1:tab' },
    });
    expect(b.result.current[0]).toBe('history');
    b.rerender({ k: 'jc:2:tab' });
    expect(b.result.current[0]).toBe('ops');
  });

  it('ignores a stored value that is no longer allowed', () => {
    sessionStorage.setItem('innovic.ui:jc:1:tab', JSON.stringify('gone'));
    const { result } = renderHook(() => usePersistentState('jc:1:tab', 'ops', oneOf(['ops'])));
    expect(result.current[0]).toBe('ops');
  });
});
