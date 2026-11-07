// Open-pages store: keeps OPENING order, and the cap never closes Home.
import { beforeEach, describe, expect, it } from 'vitest';
import { useOpenTabs, type OpenTab } from './open-tabs';

const tab = (base: string, path = base): OpenTab => ({ base, label: base, icon: '📄', path });
const open = (...bases: string[]): void => {
  for (const b of bases) useOpenTabs.getState().openTab(tab(b));
};
const bases = (): string[] => useOpenTabs.getState().tabs.map((t) => t.base);

describe('useOpenTabs', () => {
  beforeEach(() => useOpenTabs.getState().clear());

  it('at the cap keeps Home and drops the next-oldest tab', () => {
    open('/', '/a', '/b', '/c', '/d', '/e', '/f', '/g');
    open('/h');
    expect(bases()).toEqual(['/', '/b', '/c', '/d', '/e', '/f', '/g', '/h']);
  });

  it('keeps Home when it was not the first tab opened', () => {
    open('/a', '/', '/b', '/c', '/d', '/e', '/f', '/g');
    open('/h');
    expect(bases()).toEqual(['/', '/b', '/c', '/d', '/e', '/f', '/g', '/h']);
  });

  it('drops the oldest when Home is not open', () => {
    open('/a', '/b', '/c', '/d', '/e', '/f', '/g', '/i');
    open('/h');
    expect(bases()).toEqual(['/b', '/c', '/d', '/e', '/f', '/g', '/i', '/h']);
  });

  it('a reopened tab keeps its place and refreshes its path, with no eviction', () => {
    open('/', '/a', '/b', '/c', '/d', '/e', '/f', '/g');
    useOpenTabs.getState().openTab(tab('/b', '/b/123'));
    expect(bases()).toEqual(['/', '/a', '/b', '/c', '/d', '/e', '/f', '/g']);
    expect(useOpenTabs.getState().tabs[2]?.path).toBe('/b/123');
  });

  it('the user can still close Home', () => {
    open('/', '/a');
    useOpenTabs.getState().closeTab('/');
    expect(bases()).toEqual(['/a']);
  });
});
