// ADR-293 — Gemini (generateContent, v1beta) adapter, plain fetch.
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

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_TOKENS = 1500;

type Part = Record<string, unknown>;
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

function toContents(turns: Turn[]): Content[] {
  const out: Content[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      const parts: Part[] = [];
      if (t.text) parts.push({ text: t.text });
      for (const f of t.files ?? []) parts.push({ inlineData: { mimeType: f.type, data: f.data } });
      if (parts.length > 0) out.push({ role: 'user', parts });
    } else if (t.role === 'assistant') {
      // Send Gemini's own parts back untouched (they may carry thought signatures).
      if (Array.isArray(t.raw)) {
        out.push({ role: 'model', parts: t.raw as Part[] });
        continue;
      }
      const parts: Part[] = [];
      if (t.text) parts.push({ text: t.text });
      for (const c of t.toolCalls ?? [])
        parts.push({ functionCall: { name: c.name, args: c.args } });
      if (parts.length > 0) out.push({ role: 'model', parts });
    } else {
      out.push({
        role: 'user',
        parts: t.results.map((r) => ({
          functionResponse: { name: r.name, response: { result: r.content } },
        })),
      });
    }
  }
  return out;
}

interface GeminiResponse {
  modelVersion?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        functionCall?: { name?: string; args?: unknown };
      }>;
    };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export const geminiProvider: ChatProvider = {
  name: 'gemini',
  model: () => (env.GEMINI_API_KEY ? env.AI_GEMINI_MODEL : null),
  async send(req: ProviderRequest): Promise<ProviderReply> {
    const key = env.GEMINI_API_KEY;
    if (!key) throw new ProviderError('gemini', 'not_configured', 'GEMINI_API_KEY is not set');
    const model = env.AI_GEMINI_MODEL;
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toContents(req.turns),
      tools: [
        {
          // A tool with no parameters is declared without a `parameters` key.
          functionDeclarations: req.tools.map((t) =>
            Object.keys(t.parameters.properties ?? {}).length > 0
              ? t
              : { name: t.name, description: t.description },
          ),
        },
      ],
      toolConfig: { functionCallingConfig: { mode: req.toolMode === 'none' ? 'NONE' : 'AUTO' } },
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_TOKENS,
        // 2.5 Flash "thinks" out of the same token budget; switch it off so
        // 1500 tokens are all answer. (Pro models refuse a 0 budget.)
        ...(model.includes('flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    };
    const json = (await postJson(
      'gemini',
      `${BASE}/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key },
      body,
      req.signal,
    )) as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall?.name)
      .map((p, i) => ({
        id: `gemini-${i}`,
        name: String(p.functionCall?.name),
        args:
          typeof p.functionCall?.args === 'object' && p.functionCall.args !== null
            ? (p.functionCall.args as Record<string, unknown>)
            : {},
      }));
    return {
      text,
      toolCalls,
      raw: parts,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      model: json.modelVersion ?? model,
    };
  },
};
