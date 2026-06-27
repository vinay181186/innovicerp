import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { useDocNumber } from './use-doc-number';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
const mockApi = vi.mocked(apiFetch);

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).includes('code=')
        ? { exists: false, nextCode: 'IN-SO-00126', formatValid: true }
        : { exists: false, nextCode: 'IN-SO-00126', formatValid: false },
    ),
  );
});

describe('useDocNumber', () => {
  it('returns the suggested next code after mount; empty value is valid (use auto)', async () => {
    const { result } = renderHook(() => useDocNumber('sales_order', ''), { wrapper });
    await waitFor(() => expect(result.current.nextCode).toBe('IN-SO-00126'));
    expect(result.current.valid).toBe(true);
  });

  it('flags an invalid format with the exact message and marks it not valid', () => {
    const { result } = renderHook(() => useDocNumber('sales_order', 'SO-1'), { wrapper });
    expect(result.current.formatInvalid).toBe(true);
    expect(result.current.error).toBe('Invalid format — expected IN-SO-NNNNN');
    expect(result.current.valid).toBe(false);
  });

  it('detects a duplicate via the debounced backend check', async () => {
    mockApi.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('code=')
          ? { exists: true, nextCode: 'IN-SO-00126', formatValid: true }
          : { exists: false, nextCode: 'IN-SO-00126', formatValid: false },
      ),
    );
    const { result } = renderHook(() => useDocNumber('sales_order', 'IN-SO-00010'), { wrapper });
    await waitFor(() => expect(result.current.duplicate).toBe(true), { timeout: 2000 });
    expect(result.current.error).toBe('Duplicate — this number already exists');
    expect(result.current.valid).toBe(false);
  });

  it('auto-pads a short value to the canonical form', () => {
    const { result } = renderHook(() => useDocNumber('sales_order', 'IN-SO-126'), { wrapper });
    expect(result.current.padded).toBe('IN-SO-00126');
  });

  it('does NOT call the backend with a code for an invalid format', async () => {
    renderHook(() => useDocNumber('sales_order', 'SO-1'), { wrapper });
    await new Promise((r) => setTimeout(r, 700)); // past the 500ms debounce
    const codeCalls = mockApi.mock.calls.filter((c) => String(c[0]).includes('code='));
    expect(codeCalls.length).toBe(0);
  });
});
