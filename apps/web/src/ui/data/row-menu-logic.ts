// Pure helpers of the ⋯ row menu (RowMenu.tsx): which entries are drawn in
// which order, where the menu goes on screen, and where ↑ ↓ Home End move the
// focus. No React, no DOM — unit-tested in row-menu-logic.test.ts.

import type { IconName } from '../core/Icon';

/** Where an item sits in the menu. Fixed order, top to bottom. */
export type RowMenuGroup = 'main' | 'workflow' | 'assign' | 'danger';

/**
 * One entry of a row's ⋯ menu.
 *
 * Order rule (owner-approved spec): main (View · Edit · Print · Download) ·
 * workflow (under a "Workflow" header) · assign (Assign Task) · danger (red,
 * last, after a line). Within a group the caller's order is kept.
 */
export interface RowMenuItem {
  /** Stable id — unique within the row. */
  key: string;
  label: string;
  icon?: IconName | undefined;
  /**
   * The action. Return the mutation's Promise when there is one: the ⋯ then
   * shows busy and the row's menu cannot run anything else until it settles.
   */
  onSelect?: (() => void | Promise<void>) | undefined;
  /** A route: rendered as a real link, so Ctrl-click / middle-click work. */
  to?: string | undefined;
  /** Default 'main'. */
  group?: RowMenuGroup | undefined;
  /** Greys the item out and shows this short reason on its right. */
  disabledReason?: string | undefined;
  /** Left out entirely (the user lacks the right). */
  hidden?: boolean | undefined;
}

export type RowMenuEntry =
  | { type: 'item'; item: RowMenuItem }
  | { type: 'sep'; key: string }
  | { type: 'head'; key: string; label: string };

const ORDER: readonly RowMenuGroup[] = ['main', 'workflow', 'assign', 'danger'];

/** Visible items in group order, a line between groups, "Workflow" header. */
export function arrangeRowMenu(items: readonly RowMenuItem[]): RowMenuEntry[] {
  const shown = items.filter((i) => !i.hidden);
  const out: RowMenuEntry[] = [];
  for (const g of ORDER) {
    const inGroup = shown.filter((i) => (i.group ?? 'main') === g);
    if (inGroup.length === 0) continue;
    if (out.length > 0) out.push({ type: 'sep', key: `sep-${g}` });
    if (g === 'workflow') out.push({ type: 'head', key: 'head-workflow', label: 'Workflow' });
    for (const item of inGroup) out.push({ type: 'item', item });
  }
  return out;
}

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
  /** The menu scrolls inside when it is taller than this. */
  maxHeight: number;
}

export const MENU_GAP = 4;
export const MENU_EDGE = 8;
const MIN_HEIGHT = 120;

/**
 * Right edge on the button's right edge, under it — or above it when the
 * room below is too small and there is more room above. Always inside the
 * viewport (same rule as the Columns popover in TableToolbar.tsx).
 */
export function placeRowMenu(
  btn: Rect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPlacement {
  const below = viewport.height - btn.bottom - MENU_GAP - MENU_EDGE;
  const above = btn.top - MENU_GAP - MENU_EDGE;
  const maxLeft = viewport.width - menu.width - MENU_EDGE;
  const left = Math.max(MENU_EDGE, Math.min(btn.right - menu.width, maxLeft));
  if (menu.height <= below || below >= above) {
    return { left, top: btn.bottom + MENU_GAP, maxHeight: Math.max(MIN_HEIGHT, below) };
  }
  const h = Math.min(menu.height, above);
  return {
    left,
    top: Math.max(MENU_EDGE, btn.top - MENU_GAP - h),
    maxHeight: Math.max(MIN_HEIGHT, above),
  };
}

/**
 * Where a key moves the focus among `count` items: ↓ / ↑ wrap round, Home is
 * the first, End the last. `current` -1 = nothing focused yet. Returns null
 * for any other key (the caller then leaves the event alone).
 */
export function nextMenuIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** True for a value an `onSelect` returned that the menu must wait for. */
export function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'
  );
}
