// ADR-293 — the failure classifier decides whether Auto falls back to Gemini.
// Pure function, no database: `pnpm --filter @innovic/api test:unit`.
import { describe, expect, it } from 'vitest';
import { classifyProviderFailure } from './providers/classify';

describe('classifyProviderFailure — Claude', () => {
  it('402 billing_error is no credit', () => {
    expect(classifyProviderFailure('claude', 402, '{"type":"billing_error"}')).toBe('no_credit');
  });
  it.each([400, 403])('%i naming the credit balance or a spend limit is no credit', (status) => {
    expect(
      classifyProviderFailure('claude', status, 'Your credit balance is too low to access the API'),
    ).toBe('no_credit');
    expect(classifyProviderFailure('claude', status, 'You have reached your spend limit')).toBe(
      'no_credit',
    );
  });
  it('429 / 529 are busy, not credit', () => {
    expect(classifyProviderFailure('claude', 429, '{"type":"rate_limit_error"}')).toBe('busy');
    expect(classifyProviderFailure('claude', 529, '{"type":"overloaded_error"}')).toBe('busy');
  });
  it('400 without credit text is an error', () => {
    expect(classifyProviderFailure('claude', 400, 'temperature: not supported')).toBe('error');
  });
  it('500 / 401 are errors even with credit words', () => {
    expect(classifyProviderFailure('claude', 500, 'credit balance')).toBe('error');
    expect(classifyProviderFailure('claude', 401, 'invalid x-api-key')).toBe('error');
  });
});

describe('classifyProviderFailure — Gemini', () => {
  it('a per-day quota is no credit', () => {
    expect(
      classifyProviderFailure(
        'gemini',
        429,
        '"status":"RESOURCE_EXHAUSTED" GenerateRequestsPerDayPerProjectPerModel-FreeTier',
      ),
    ).toBe('no_credit');
    expect(classifyProviderFailure('gemini', 403, 'You exceeded your current quota')).toBe(
      'no_credit',
    );
  });
  it('a per-minute quota is busy', () => {
    expect(
      classifyProviderFailure(
        'gemini',
        429,
        'RESOURCE_EXHAUSTED GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
      ),
    ).toBe('busy');
  });
  it('anything else is an error, billing words included', () => {
    expect(classifyProviderFailure('gemini', 400, 'API key not valid')).toBe('error');
    expect(classifyProviderFailure('gemini', 400, 'billing account')).toBe('error');
    expect(classifyProviderFailure('gemini', 500, 'internal')).toBe('error');
  });
});
