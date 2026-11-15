// ADR-293 — the one HTTP attempt both adapters make. No retry, no backoff.
import type { AiChatProvider } from '@innovic/shared';
import { classifyProviderFailure } from './classify';
import { ProviderError } from './types';

const ERROR_TEXT_MAX = 300;

export async function postJson(
  provider: AiChatProvider,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ProviderError(
      provider,
      'error',
      timedOut ? 'The AI did not answer in time.' : `Could not reach the AI: ${String(e)}`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(
      provider,
      classifyProviderFailure(provider, res.status, text),
      `HTTP ${res.status}: ${text.slice(0, ERROR_TEXT_MAX)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(provider, 'error', 'The AI sent back an unreadable reply.');
  }
}
