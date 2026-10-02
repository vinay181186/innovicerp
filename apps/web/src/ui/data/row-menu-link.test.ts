import { describe, expect, it } from 'vitest';
import { splitRowMenuTo } from './row-menu-link';

describe('splitRowMenuTo', () => {
  it('leaves a plain path alone', () => {
    expect(splitRowMenuTo('/users/abc/edit')).toEqual({
      path: '/users/abc/edit',
      search: undefined,
    });
  });

  it('splits the query into a search object', () => {
    expect(splitRowMenuTo('/op-entry?jobCardId=jc1&opId=op2')).toEqual({
      path: '/op-entry',
      search: { jobCardId: 'jc1', opId: 'op2' },
    });
  });

  it('decodes encoded values', () => {
    expect(splitRowMenuTo('/access-control?configure=a%20b%26c')).toEqual({
      path: '/access-control',
      search: { configure: 'a b&c' },
    });
  });

  it('treats a trailing ? as no query', () => {
    expect(splitRowMenuTo('/items?')).toEqual({ path: '/items', search: undefined });
  });
});
