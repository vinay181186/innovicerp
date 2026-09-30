import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSaveKey, withSaveKey } from './use-save-key';

vi.mock('./api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  let n = 0;
  return { ApiError, newRequestKey: () => `k${++n}` };
});

const { ApiError } = (await import('./api')) as unknown as {
  ApiError: new (status: number, code: string, message: string) => Error;
};

describe('withSaveKey', () => {
  it('reuses the key after a timeout / network error (outcome unknown)', async () => {
    const { result } = renderHook(() => useSaveKey());
    const k = result.current.current();
    await withSaveKey(result.current, () => Promise.reject(new ApiError(0, 'timeout', 'x'))).catch(
      () => undefined,
    );
    expect(result.current.current()).toBe(k);
    await withSaveKey(result.current, () =>
      Promise.reject(new ApiError(409, 'in_progress', 'x')),
    ).catch(() => undefined);
    expect(result.current.current()).toBe(k);
    await withSaveKey(result.current, () => Promise.reject(new ApiError(502, 'x', 'x'))).catch(
      () => undefined,
    );
    expect(result.current.current()).toBe(k);
  });

  it('rotates the key after success and after a definite 4xx', async () => {
    const { result } = renderHook(() => useSaveKey());
    const k1 = result.current.current();
    await withSaveKey(result.current, () => Promise.resolve('ok'));
    const k2 = result.current.current();
    expect(k2).not.toBe(k1);
    await withSaveKey(result.current, () =>
      Promise.reject(new ApiError(400, 'validation_error', 'x')),
    ).catch(() => undefined);
    expect(result.current.current()).not.toBe(k2);
  });

  it('sends the form key as the Idempotency-Key header and tracks in-flight saves', async () => {
    const { result } = renderHook(() => useSaveKey());
    const k = result.current.current();
    let seen: Record<string, string> | undefined;
    let inFlightDuring = -1;
    await withSaveKey(result.current, (headers) => {
      seen = headers;
      inFlightDuring = result.current.inFlight.count;
      return Promise.resolve(null);
    });
    expect(seen).toEqual({ 'idempotency-key': k });
    expect(inFlightDuring).toBe(1);
    expect(result.current.inFlight.count).toBe(0);
  });

  it('without a key it runs the write unchanged', async () => {
    const run = vi.fn(() => Promise.resolve(1));
    await withSaveKey(undefined, run);
    expect(run).toHaveBeenCalledWith(undefined);
  });
});
