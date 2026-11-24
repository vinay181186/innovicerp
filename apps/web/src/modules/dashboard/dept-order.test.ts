// The home's left menu lists departments in the TOP MENU's order (owner
// 2026-11-24). DASH_CHECK_DEPTS is a second list, so this test keeps the two
// in step: reorder the top menu and this fails until the home list follows.
import { DASH_CHECK_DEPTS } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { ORDERED_SECTIONS } from '@/components/shared/nav-sections';

describe('home department order', () => {
  it('equals the top menu order', () => {
    const home = new Set<string>(DASH_CHECK_DEPTS);
    const top = ORDERED_SECTIONS.map((s) => s.key).filter((k) => home.has(k));
    expect([...DASH_CHECK_DEPTS]).toEqual(top);
  });
});
