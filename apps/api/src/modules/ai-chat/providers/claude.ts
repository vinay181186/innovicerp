// ADR-293 — Claude (Anthropic Messages API) adapter, plain fetch.
import { env } from '../../../lib/env';
import { postJson } from './http';
import {
  type ChatProvider,
  type ProviderReply,
  type ProviderRequest,
  ProviderError,
  type ToolCall,
  type Turn,
} from './types';

const URL = 'https://api.anthropic.com/v1/messages';
/** Room for a 50-row table; thinking is off on Sonnet 5.5 (below). */
const MAX_TOKENS = 4000;

/** Sonnet 5.5 thinks by default and rejects `disabled`; `between_tools` turns it
 *  off (accepted at the default effort). Other models keep their own default. */
const thinkingFor = (model: string): Block | undefined =>
  model.startsWith('claude-sonnet-5-5') ? { type: 'between_tools' } : undefined;

type Block = Record<string, unknown>;
interface Message {
  role: 'user' | 'assistant';
  content: Block[];
}

function toMessages(turns: Turn[]): Message[] {
  const out: Message[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      const content: Block[] = [];
      for (const f of t.files ?? []) {
        content.push(
          f.type === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: f.type, data: f.data } }
            : { type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } },
        );
      }
      if (t.text) content.push({ type: 'text', text: t.text });
      if (content.length > 0) out.push({ role: 'user', content });
    } else if (t.role === 'assistant') {
      // Claude's own blocks go back unchanged (thinking blocks included — the
      // API checks them against the conversation that produced them).
      if (Array.isArray(t.raw) && t.raw.length > 0) {
        out.push({ role: 'assistant', content: t.raw as Block[] });
        continue;
      }
      const content: Block[] = [];
      if (t.text) content.push({ type: 'text', text: t.text });
      for (const c of t.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      }
      if (content.length > 0) out.push({ role: 'assistant', content });
    } else {
      out.push({
        role: 'user',
        content: t.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
        })),
      });
    }
  }
  return out;
}

interface ClaudeResponse {
  model?: string;
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const claudeProvider: ChatProvider = {
  name: 'claude',
  model: () => (env.ANTHROPIC_API_KEY ? env.AI_CLAUDE_MODEL : null),
  async send(req: ProviderRequest): Promise<ProviderReply> {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new ProviderError('claude', 'not_configured', 'ANTHROPIC_API_KEY is not set');
    // No temperature: current models reject non-default sampling values.
    const thinking = thinkingFor(env.AI_CLAUDE_MODEL);
    const body = {
      model: env.AI_CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      ...(thinking ? { thinking } : {}),
      system: req.system,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      // Tools stay declared on the last round (earlier tool_use blocks need
      // them); 'none' makes Claude answer from what it already has.
      tool_choice: { type: req.toolMode },
      messages: toMessages(req.turns),
    };
    const json = (await postJson(
      'claude',
      URL,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body,
      req.signal,
    )) as ClaudeResponse;
    const blocks = json.content ?? [];
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === 'tool_use' && b.id && b.name)
      .map((b) => ({
        id: String(b.id),
        name: String(b.name),
        args:
          typeof b.input === 'object' && b.input !== null
            ? (b.input as Record<string, unknown>)
            : {},
      }));
    return {
      text,
      toolCalls,
      raw: blocks,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      model: json.model ?? env.AI_CLAUDE_MODEL,
    };
  },
};
