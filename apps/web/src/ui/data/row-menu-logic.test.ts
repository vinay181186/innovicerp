import { describe, expect, it } from 'vitest';

import {
  arrangeRowMenu,
  isThenable,
  MENU_EDGE,
  MENU_GAP,
  nextMenuIndex,
  placeRowMenu,
  type RowMenuItem,
} from './row-menu-logic';

const kinds = (items: RowMenuItem[]) =>
  arrangeRowMenu(items).map((e) => (e.type === 'item' ? e.item.key : e.type));

describe('arrangeRowMenu', () => {
  it('orders main · workflow · assign · danger with a line between groups', () => {
    const items: RowMenuItem[] = [
      { key: 'del', label: 'Delete', group: 'danger' },
      { key: 'assign', label: 'Assign Task', group: 'assign' },
      { key: 'start', label: 'Start Operation', group: 'workflow' },
      { key: 'edit', label: 'Edit' },
      { key: 'print', label: 'Print', group: 'main' },
    ];
    expect(kinds(items)).toEqual([
      'edit',
      'print',
      'sep',
      'head',
      'start',
      'sep',
      'assign',
      'sep',
      'del',
    ]);
  });

  it('drops hidden items and the lines / header of empty groups', () => {
    const items: RowMenuItem[] = [
      { key: 'edit', label: 'Edit' },
      { key: 'start', label: 'Start', group: 'workflow', hidden: true },
      { key: 'del', label: 'Delete', group: 'danger' },
    ];
    expect(kinds(items)).toEqual(['edit', 'sep', 'del']);
  });

  it('gives no leading line when the first group is not main', () => {
    expect(kinds([{ key: 'del', label: 'Delete', group: 'danger' }])).toEqual(['del']);
    expect(kinds([])).toEqual([]);
  });
});

describe('placeRowMenu', () => {
  const vp = { width: 1000, height: 800 };
  const btn = { top: 100, bottom: 122, left: 900, right: 926 };

  it('opens under the button, right edges aligned', () => {
    const p = placeRowMenu(btn, { width: 200, height: 150 }, vp);
    expect(p?.left).toBe(726);
    expect(p?.top).toBe(122 + MENU_GAP);
  });

  it('flips above near the bottom of the screen', () => {
    const low = { top: 700, bottom: 722, left: 900, right: 926 };
    const p = placeRowMenu(low, { width: 200, height: 150 }, vp);
    expect(p?.top).toBe(700 - MENU_GAP - 150);
    expect(p?.maxHeight).toBe(700 - MENU_GAP - MENU_EDGE);
  });

  it('stays inside the viewport on both sides', () => {
    const nearLeft = { top: 100, bottom: 122, left: 10, right: 36 };
    expect(placeRowMenu(nearLeft, { width: 200, height: 50 }, vp)?.left).toBe(MENU_EDGE);
    const atRight = { top: 100, bottom: 122, left: 980, right: 1006 };
    expect(placeRowMenu(atRight, { width: 200, height: 50 }, vp)?.left).toBe(
      1000 - 200 - MENU_EDGE,
    );
  });

  it('clamps a menu taller than the room above to the top edge', () => {
    const low = { top: 300, bottom: 322, left: 900, right: 926 };
    const p = placeRowMenu(low, { width: 200, height: 900 }, { width: 1000, height: 400 });
    expect(p?.top).toBe(MENU_EDGE);
    expect(p?.maxHeight).toBe(300 - MENU_GAP - MENU_EDGE);
  });

  it('never lets the max height run past the screen edge', () => {
    // Little room either side: the larger side wins, capped at that room.
    const mid = { top: 30, bottom: 52, left: 900, right: 926 };
    const p = placeRowMenu(mid, { width: 200, height: 300 }, { width: 1000, height: 100 });
    expect(p?.top).toBe(52 + MENU_GAP);
    expect(p?.maxHeight).toBe(100 - 52 - MENU_GAP - MENU_EDGE);
    // Button flush with the bottom edge: room below is 0, never negative.
    const flush = { top: 380, bottom: 400, left: 900, right: 926 };
    const q = placeRowMenu(flush, { width: 200, height: 50 }, { width: 1000, height: 400 });
    expect(q?.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('gives null once the button has left the viewport', () => {
    expect(
      placeRowMenu(
        { top: -40, bottom: -18, left: 900, right: 926 },
        { width: 200, height: 50 },
        vp,
      ),
    ).toBeNull();
    expect(
      placeRowMenu(
        { top: 810, bottom: 832, left: 900, right: 926 },
        { width: 200, height: 50 },
        vp,
      ),
    ).toBeNull();
    expect(
      placeRowMenu(
        { top: 100, bottom: 122, left: 1100, right: 1126 },
        { width: 200, height: 50 },
        vp,
      ),
    ).toBeNull();
  });
});

describe('nextMenuIndex', () => {
  it('moves and wraps with the arrows', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(nextMenuIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextMenuIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextMenuIndex(-1, 'ArrowUp', 3)).toBe(2);
  });

  it('jumps with Home / End and ignores other keys', () => {
    expect(nextMenuIndex(1, 'Home', 3)).toBe(0);
    expect(nextMenuIndex(1, 'End', 3)).toBe(2);
    expect(nextMenuIndex(1, 'Enter', 3)).toBeNull();
    expect(nextMenuIndex(0, 'ArrowDown', 0)).toBeNull();
  });

  it('skips disabled items with the arrows and Home / End', () => {
    const dis = [true, false, true, false, true];
    expect(nextMenuIndex(-1, 'ArrowDown', 5, dis)).toBe(1);
    expect(nextMenuIndex(1, 'ArrowDown', 5, dis)).toBe(3);
    expect(nextMenuIndex(3, 'ArrowDown', 5, dis)).toBe(1);
    expect(nextMenuIndex(1, 'ArrowUp', 5, dis)).toBe(3);
    expect(nextMenuIndex(-1, 'ArrowUp', 5, dis)).toBe(3);
    expect(nextMenuIndex(3, 'Home', 5, dis)).toBe(1);
    expect(nextMenuIndex(1, 'End', 5, dis)).toBe(3);
    expect(nextMenuIndex(0, 'ArrowDown', 2, [true, true])).toBeNull();
  });
});

describe('isThenable', () => {
  it('spots a promise and nothing else', () => {
    expect(isThenable(Promise.resolve())).toBe(true);
    expect(isThenable(undefined)).toBe(false);
    expect(isThenable({ then: 1 })).toBe(false);
  });
});
