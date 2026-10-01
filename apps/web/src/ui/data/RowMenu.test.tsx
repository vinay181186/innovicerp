import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RowMenu } from './RowMenu';
import type { RowMenuItem } from './row-menu-logic';

function inRow(items: RowMenuItem[], onRow = vi.fn()) {
  render(
    <table>
      <tbody>
        <tr onClick={onRow}>
          <td>
            <RowMenu items={items} />
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return onRow;
}

describe('RowMenu', () => {
  it('opens on click, runs an item, closes, and never fires the row click', () => {
    const edit = vi.fn();
    const onRow = inRow([{ key: 'edit', label: 'Edit', onSelect: edit }]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(edit).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows a greyed item with its reason and does not run it', () => {
    const del = vi.fn();
    inRow([
      { key: 'edit', label: 'Edit' },
      { key: 'del', label: 'Delete', group: 'danger', onSelect: del, disabledReason: 'Closed' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const item = screen.getByRole('menuitem', { name: /Delete/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Closed');
    fireEvent.click(item);
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('stays busy while a Promise action runs', async () => {
    let finish: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<void>((r) => (finish = r)));
    inRow([{ key: 'xls', label: 'Download Excel', onSelect: slow }]);
    const btn = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download Excel' }));
    expect(btn.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(btn);
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => finish());
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('keeps only one row menu open at a time', () => {
    render(
      <>
        <RowMenu label="Row 1" items={[{ key: 'a', label: 'A' }]} />
        <RowMenu label="Row 2" items={[{ key: 'b', label: 'B' }]} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Row 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Row 2' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'B' })).toBeTruthy();
  });

  it('moves with the arrow keys and closes on Escape, focus back on ⋯', () => {
    inRow([
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]);
    const btn = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('A');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('B');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('clears busy and reports a rejected Promise action', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail: (e: Error) => void = () => undefined;
    const slow = vi.fn(() => new Promise<void>((_, rej) => (fail = rej)));
    inRow([{ key: 'x', label: 'Approve', onSelect: slow }]);
    const btn = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approve' }));
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await act(async () => fail(new Error('boom')));
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('catches an action that throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    inRow([
      {
        key: 'x',
        label: 'Boom',
        onSelect: () => {
          throw new Error('boom');
        },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Boom' }));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('gives a renderLink item the menuitem role', () => {
    render(
      <RowMenu
        items={[{ key: 'v', label: 'View', to: '/x/1' }]}
        renderLink={(p) => (
          <a href={p.to} role={p.role} className={p.className}>
            {p.children}
          </a>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'View' }).getAttribute('href')).toBe('/x/1');
  });

  it('skips a greyed item with the arrows', () => {
    inRow([
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', disabledReason: 'No' },
      { key: 'c', label: 'C' },
    ]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('A');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('C');
  });

  it('keeps Escape away from listeners outside the menu (a Modal)', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer, true);
    inRow([{ key: 'a', label: 'A' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer, true);
  });

  it('renders nothing when every item is hidden', () => {
    const { container } = render(<RowMenu items={[{ key: 'a', label: 'A', hidden: true }]} />);
    expect(container.innerHTML).toBe('');
  });
});
