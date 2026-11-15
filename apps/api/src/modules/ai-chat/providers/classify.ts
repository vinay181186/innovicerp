// ADR-293 — sort a failed provider call: credit / quota finished, busy (a
// per-minute rate limit — NOT credit), or something else. Pure: no env, no
// network, so the unit test runs bare.
import type { AiChatProvider } from '@innovic/shared';

export type ClassifiedFailure = 'no_credit' | 'busy' | 'error';

/** Anthropic: 402 billing_error; a low balance or a reached spend / usage
 *  limit can also come back as a 400 invalid_request_error naming it. */
const CLAUDE_CREDIT_TEXT = /billing_error|credit balance|spend(ing)? limit|usage limit/i;
/** Google free tier: a 429 RESOURCE_EXHAUSTED names the quota; a per-minute
 *  one passes in a minute, a per-day one is the free quota used up. */
const GEMINI_PER_MINUTE = /PerMinute|per minute/i;

export function classifyProviderFailure(
  provider: AiChatProvider,
  status: number,
  body: string,
): ClassifiedFailure {
  if (provider === 'claude') {
    if (status === 402) return 'no_credit';
    if ((status === 400 || status === 403) && CLAUDE_CREDIT_TEXT.test(body)) return 'no_credit';
    if (status === 429 || status === 529) return 'busy';
    return 'error';
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|exceeded your current quota/i.test(body)) {
    return GEMINI_PER_MINUTE.test(body) ? 'busy' : 'no_credit';
  }
  return 'error';
}
