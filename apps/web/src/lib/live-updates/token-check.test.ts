import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const { tokenCompanyId } = await import('./token-check');

const jwt = (claims: object): string =>
  `x.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.y`;

describe('tokenCompanyId', () => {
  it('reads company_id from app_metadata or the top level', () => {
    expect(tokenCompanyId(jwt({ app_metadata: { company_id: 'co-1' } }))).toBe('co-1');
    expect(tokenCompanyId(jwt({ company_id: 'co-2' }))).toBe('co-2');
  });
  it('is null for a token without a company, a blank one, or garbage', () => {
    expect(tokenCompanyId(jwt({ sub: 'u', app_metadata: { app_role: 'manager' } }))).toBeNull();
    expect(tokenCompanyId(jwt({ company_id: '' }))).toBeNull();
    expect(tokenCompanyId('not-a-token')).toBeNull();
    expect(tokenCompanyId(undefined)).toBeNull();
  });
});
