import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/use-ui-settings', () => ({
  useTableDensity: () => ({ density: 'comfortable', setDensity: () => undefined }),
}));

import { DataTable } from './DataTable';

interface Row {
  id: string;
  machine: string;
  jc: string;
}
const ROWS: Row[] = [
  { id: '1', machine: 'VMC-1', jc: 'JC-1' },
  { id: '2', machine: 'VMC-1', jc: 'JC-2' },
  { id: '3', machine: 'VMC-2', jc: 'JC-3' },
];

describe('DataTable groupRow (ADR-203)', () => {
  it('draws one full-width heading where the group changes, inside the one table', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DataTable
          columns={[{ id: 'jc', header: 'JC No.', key: 'jc' }]}
          rows={ROWS}
          groupRow={(r, _i, prev) => (prev?.machine === r.machine ? null : `${r.machine} jobs`)}
        />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const headings = document.querySelectorAll('tr.dt-group-row');
    expect([...headings].map((h) => h.textContent)).toEqual(['VMC-1 jobs', 'VMC-2 jobs']);
    expect(headings[0]?.querySelector('td')?.getAttribute('colspan')).toBe('1');
  });
});
