// ADR-293 — the one small interface both AI providers sit behind.
import type { AiChatFile, AiChatProvider } from '@innovic/shared';

/** JSON-schema subset both Claude and Gemini accept (no additionalProperties). */
export interface ToolParamSchema {
  type: 'object' | 'string' | 'integer' | 'number' | 'array' | 'boolean';
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParamSchema>;
  required?: string[];
  items?: ToolParamSchema;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolParamSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** Compact JSON text of the tool's output (or of `{ error }`). */
  content: string;
}

export type Turn =
  | { role: 'user'; text: string; files?: AiChatFile[] }
  | {
      role: 'assistant';
      text: string;
      toolCalls?: ToolCall[];
      /** Provider's own content, sent back as-is on the next call (Gemini parts). */
      raw?: unknown;
    }
  | { role: 'tool'; results: ToolResult[] };

export interface ProviderRequest {
  system: string;
  turns: Turn[];
  tools: ToolSpec[];
  /** 'none' = the final round: answer from what has been looked up. */
  toolMode: 'auto' | 'none';
  signal: AbortSignal;
}

export interface ProviderReply {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** busy = a per-minute rate limit: NOT credit, so Auto does not fall back. */
export type ProviderFailureKind = 'no_credit' | 'busy' | 'not_configured' | 'error';

export class ProviderError extends Error {
  constructor(
    readonly provider: AiChatProvider,
    readonly kind: ProviderFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ChatProvider {
  readonly name: AiChatProvider;
  /** The model id this provider will call, or null when its key is missing. */
  model(): string | null;
  /** Exactly one HTTP attempt — no retry. Throws ProviderError. */
  send(req: ProviderRequest): Promise<ProviderReply>;
}
