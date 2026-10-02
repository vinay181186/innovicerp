import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The density setting talks to the API; these tests only need its value.
// The table engine's saved-layout code imports the API client; not used here.
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/use-ui-settings', () => ({
  useTableDensity: () => ({ density: 'comfortable', setDensity: () => undefined }),
}));

import { ListFooter } from '../../layout/ListFooter';
import { ListHeader } from '../../layout/ListHeader';
import { DataTable } from '../DataTable';
import type { DataTableColumn } from '../data-table-types';
import type { SfState } from './filter-model';
import { SfScopeStore, SortFilterProvider } from './scope';

interface Row {
  id: string;
  code: string;
  status: string;
  qty: number;
  due: string;
}

const ROWS: Row[] = [
  { id: '1', code: 'IN-JC-00010', status: 'Open', qty: 5, due: '28-Sep-2026' },
  { id: '2', code: 'IN-JC-00009', status: 'Closed', qty: 20, due: '15-Aug-2026' },
  { id: '3', code: 'IN-JC-00011', status: 'Open', qty: 1, due: '—' },
];

const COLS: Array<DataTableColumn<Row>> = [
  { id: 'sr_no', header: 'Sr No', render: (_r, i) => i + 1 },
  { id: 'code', header: 'JC No.', render: (r) => <b>{r.code}</b> },
  { id: 'status', header: 'Status', kind: 'badge', key: 'status' },
  { id: 'qty', header: 'Order Qty', align: 'right', render: (r) => <>{r.qty} Nos</> },
  { id: 'due', header: 'Due Date', key: 'due' },
];

function Page({ partial = false }: { partial?: boolean }): ReactNode {
  return (
    <>
      <ListHeader title="Job Cards" search="" onSearch={() => undefined} />
      <DataTable columns={COLS} rows={ROWS} />
      <ListFooter total={partial ? 400 : 3} limit={200} />
    </>
  );
}

function mount(partial = false) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <SortFilterProvider store={new SfScopeStore()}>
        <Page partial={partial} />
      </SortFilterProvider>
    </QueryClientProvider>,
  );
}

const codes = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[1]?.textContent ?? '');

describe('Sort & Filter', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('is off by default; the button shows the ▾ in every data column but Sr No', () => {
    mount();
    expect(screen.queryByRole('button', { name: /Sort or filter/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Sort & Filter/ }));
    expect(screen.getByRole('button', { name: 'Sort or filter JC No.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort or filter Due Date' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sort or filter Sr No' })).toBeNull();
  });

  it('sorts codes naturally and dates by date, blanks last', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Sort & Filter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter JC No.' }));
    fireEvent.click(screen.getByRole('button', { name: /A → Z/ }));
    expect(codes()).toEqual(['IN-JC-00009', 'IN-JC-00010', 'IN-JC-00011']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter Due Date' }));
    fireEvent.click(screen.getByRole('button', { name: /Newest → Oldest/ }));
    expect(codes()).toEqual(['IN-JC-00010', 'IN-JC-00009', 'IN-JC-00011']);
  });

  it('tick list filter + number condition, count on the button, Showing X of Y, Clear', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Sort & Filter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter Status' }));
    const dlg = screen.getByRole('dialog', { name: 'Sort and filter Status' });
    fireEvent.click(within(dlg).getByLabelText('Closed'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
    expect(codes()).toEqual(['IN-JC-00010', 'IN-JC-00011']);
    expect(screen.getByText(/Showing 2 of 3/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sort & Filter \(1\)/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter Order Qty' }));
    const q = screen.getByRole('dialog', { name: 'Sort and filter Order Qty' });
    fireEvent.change(within(q).getByLabelText('Order Qty condition'), { target: { value: 'gt' } });
    fireEvent.change(within(q).getByLabelText('Value'), { target: { value: '2' } });
    fireEvent.click(within(q).getByRole('button', { name: 'OK' }));
    expect(codes()).toEqual(['IN-JC-00010']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(codes()).toHaveLength(3);
  });

  it('turning it off with filters asks keep or clear', () => {
    mount();
    const btn = screen.getByRole('button', { name: /Sort & Filter/ });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter Status' }));
    fireEvent.click(screen.getByLabelText('Open'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: /Sort & Filter \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep filters' }));
    expect(codes()).toEqual(['IN-JC-00009']);
    expect(screen.queryByRole('button', { name: /Sort or filter/ })).toBeNull();
    expect(screen.getByLabelText('filtered')).toBeTruthy();
  });

  it('is disabled when the list shows only part of the data', () => {
    mount(true);
    const btn = screen.getByRole('button', { name: /Sort & Filter/ });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(screen.queryByRole('button', { name: /Sort or filter/ })).toBeNull();
  });

  it('a table outside any scope renders unchanged', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DataTable columns={COLS} rows={ROWS} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /Sort & Filter/ })).toBeNull();
  });

  it('Enter / Space inside the menu never reach a sortable header', () => {
    let sorts = 0;
    const cols: Array<DataTableColumn<Row>> = COLS.map((c) =>
      c.id === 'code' ? { ...c, sortField: 'code' } : c,
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SortFilterProvider store={new SfScopeStore()}>
          <ListHeader title="T" search="" onSearch={() => undefined} />
          <DataTable columns={cols} rows={ROWS} onSort={() => (sorts += 1)} />
        </SortFilterProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sort & Filter/ }));
    const caret = screen.getByRole('button', { name: 'Sort or filter JC No.' });
    fireEvent.keyDown(caret, { key: 'Enter' });
    fireEvent.click(caret);
    const dlg = screen.getByRole('dialog', { name: 'Sort and filter JC No.' });
    fireEvent.keyDown(within(dlg).getByLabelText('Text'), { key: ' ' });
    fireEvent.keyDown(within(dlg).getByLabelText('Text'), { key: 'Enter' });
    expect(sorts).toBe(0);
  });

  it('a hand-built totals footer is hidden while a filter applies', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SortFilterProvider store={new SfScopeStore()}>
          <ListHeader title="T" search="" onSearch={() => undefined} />
          <DataTable
            columns={COLS}
            rows={ROWS}
            footer={
              <tr>
                <td>ALL-ROWS-TOTAL</td>
              </tr>
            }
          />
        </SortFilterProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('ALL-ROWS-TOTAL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sort & Filter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter Status' }));
    fireEvent.click(screen.getByLabelText('Closed'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText('ALL-ROWS-TOTAL')).toBeNull();
  });

  it('server mode: hands the filter to the page by field, keeps rows, works on a capped list', () => {
    let last: SfState = { sort: null, filters: {} };
    const server = {
      value: last,
      onChange: (next: SfState | ((p: SfState) => SfState)) => {
        last = typeof next === 'function' ? next(last) : next;
      },
      param: undefined,
    };
    const cols: Array<DataTableColumn<Row>> = [
      { id: 'code', header: 'JC No.', render: (r) => r.code, sortFilterField: 'jcCode' },
      {
        id: 'status',
        header: 'Status',
        kind: 'badge',
        key: 'status',
        sortFilterField: 'status',
        filterOptions: [
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
        ],
      },
      { id: 'qty', header: 'Order Qty', align: 'right', render: (r) => r.qty },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SortFilterProvider store={new SfScopeStore()}>
          <ListHeader title="T" search="" onSearch={() => undefined} />
          <DataTable columns={cols} rows={ROWS} sortFilterServer={server} />
          <ListFooter total={400} limit={200} />
        </SortFilterProvider>
      </QueryClientProvider>,
    );
    const btn = screen.getByRole('button', { name: /Sort & Filter/ });
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(btn);
    // A column without a server field has no ▾.
    expect(screen.queryByRole('button', { name: 'Sort or filter Order Qty' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter Status' }));
    const dlg = screen.getByRole('dialog', { name: 'Sort and filter Status' });
    fireEvent.click(within(dlg).getByLabelText('Closed'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
    expect(last.filters).toEqual({ status: { kind: 'values', values: ['open'] } });
    expect(codes()).toHaveLength(3);
    // Text columns: conditions only, no tick list of a partial page.
    fireEvent.click(screen.getByRole('button', { name: 'Sort or filter JC No.' }));
    const t = screen.getByRole('dialog', { name: 'Sort and filter JC No.' });
    expect(within(t).queryByRole('searchbox')).toBeNull();
    fireEvent.click(within(t).getByRole('button', { name: /Z → A/ }));
    expect(last.sort).toEqual({ id: 'jcCode', dir: 'desc' });
  });
});
