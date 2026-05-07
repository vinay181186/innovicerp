import { describe, expect, it, vi } from 'vitest';
import { resolveCorsOriginFrom } from './cors';

describe('resolveCorsOriginFrom', () => {
  it('returns the explicit allowlist when ALLOWED_ORIGINS is non-empty', () => {
    const result = resolveCorsOriginFrom({
      allowedOrigins: ['https://erp.example.com', 'https://erp-staging.example.com'],
      nodeEnv: 'production',
    });
    expect(result).toEqual(['https://erp.example.com', 'https://erp-staging.example.com']);
  });

  it('falls back to permissive (true) in dev with empty allowlist + warns', () => {
    const warn = vi.fn();
    const result = resolveCorsOriginFrom({
      allowedOrigins: [],
      nodeEnv: 'development',
      log: { warn },
    });
    expect(result).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).toMatch(/ALLOWED_ORIGINS/);
  });

  it('falls back to permissive (true) in test with empty allowlist', () => {
    const result = resolveCorsOriginFrom({
      allowedOrigins: [],
      nodeEnv: 'test',
    });
    expect(result).toBe(true);
  });

  it('throws in production with empty allowlist', () => {
    expect(() =>
      resolveCorsOriginFrom({
        allowedOrigins: [],
        nodeEnv: 'production',
      }),
    ).toThrow(/ALLOWED_ORIGINS is required in production/);
  });
});
