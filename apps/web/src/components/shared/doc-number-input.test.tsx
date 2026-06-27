import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { DocNumberInput } from './doc-number-input';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
const mockApi = vi.mocked(apiFetch);

function Harness({ initial }: { initial: string }): React.JSX.Element {
  const [v, setV] = useState(initial);
  const [valid, setValid] = useState<boolean | null>(null);
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <DocNumberInput type="sales_order" value={v} onChange={setV} onValidityChange={setValid} required />
      <div data-testid="valid">{String(valid)}</div>
    </QueryClientProvider>
  );
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

describe('DocNumberInput', () => {
  it('prefills the suggested next number when empty', async () => {
    render(<Harness initial="" />);
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('IN-SO-00126'),
    );
  });

  it('shows the green "Available" state for a unique, well-formed number', async () => {
    render(<Harness initial="IN-SO-00010" />);
    await waitFor(() => expect(screen.getByText('✓ Available')).toBeTruthy());
    expect(screen.getByTestId('valid').textContent).toBe('true');
  });

  it('shows the duplicate error and marks the field invalid', async () => {
    mockApi.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('code=')
          ? { exists: true, nextCode: 'IN-SO-00126', formatValid: true }
          : { exists: false, nextCode: 'IN-SO-00126', formatValid: false },
      ),
    );
    render(<Harness initial="IN-SO-00010" />);
    await waitFor(() =>
      expect(screen.getByText('Duplicate — this number already exists')).toBeTruthy(),
    );
    expect(screen.getByTestId('valid').textContent).toBe('false');
  });

  it('shows the format error for a mis-formatted value (no backend needed)', () => {
    render(<Harness initial="SO-1" />);
    expect(screen.getByText('Invalid format — expected IN-SO-NNNNN')).toBeTruthy();
    expect(screen.getByTestId('valid').textContent).toBe('false');
  });

  it('auto-pads a short value to the canonical form on blur', () => {
    render(<Harness initial="IN-SO-126" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.blur(input);
    expect(input.value).toBe('IN-SO-00126');
  });
});
