// The bar's display order: Home, then top-menu order, then anything not in the menu.
import { describe, expect, it, vi } from 'vitest';
import { inMenuOrder } from './open-tabs-bar';

vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const of = (...bases: string[]): { base: string }[] => bases.map((base) => ({ base }));
const sorted = (...bases: string[]): string[] => inMenuOrder(of(...bases)).map((t) => t.base);

describe('inMenuOrder', () => {
  it('puts Home first', () => {
    expect(sorted('/job-cards', '/')).toEqual(['/', '/job-cards']);
  });

  it('follows the menu whatever order the tabs were opened in', () => {
    const want = ['/planning', '/plans', '/job-cards'];
    expect(sorted('/job-cards', '/plans', '/planning')).toEqual(want);
    expect(sorted('/plans', '/planning', '/job-cards')).toEqual(want);
    expect(sorted('/planning', '/job-cards', '/plans')).toEqual(want);
  });

  it('a base not in the menu goes last and keeps opening order', () => {
    expect(sorted('/zzz-b', '/job-cards', '/zzz-a', '/')).toEqual([
      '/',
      '/job-cards',
      '/zzz-b',
      '/zzz-a',
    ]);
  });

  it('does not mutate its input', () => {
    const input = of('/job-cards', '/');
    inMenuOrder(input);
    expect(input.map((t) => t.base)).toEqual(['/job-cards', '/']);
  });
});
