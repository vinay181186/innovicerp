// ADR-293 — one question with one provider: send, run the tools it asks for,
// send the results back; at most MAX_TOOL_ROUNDS rounds, then a forced answer.
import type { AiChatFile, AiChatTurn } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { logger } from '../../lib/logger';
import { compactForAi } from './compact';
import { buildSystemPrompt } from './prompt';
import type { ChatProvider, ToolCall, ToolResult, Turn } from './providers/types';
import { AI_TOOL_SPECS, findTool } from './tools';

export const MAX_TOOL_ROUNDS = 6;

export interface ToolLogEntry {
  name: string;
  args: Record<string, unknown>;
  rows: number;
  error?: string;
}

export interface ConversationResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** What the tools did, across providers (Auto may try two). */
export interface ToolTrail {
  lookedUp: Set<string>;
  log: ToolLogEntry[];
}

function startTurns(history: AiChatTurn[], question: string, files: AiChatFile[]): Turn[] {
  const turns: Turn[] = [];
  for (const h of history) {
    if (!h.text.trim()) continue;
    // Both providers want the conversation to open with the person.
    if (turns.length === 0 && h.role === 'assistant') continue;
    turns.push({ role: h.role, text: h.text });
  }
  turns.push({ role: 'user', text: question, files });
  return turns;
}

async function runToolCall(call: ToolCall, roUser: AuthContext, trail: ToolTrail) {
  const tool = findTool(call.name);
  if (!tool) {
    trail.log.push({ name: call.name, args: call.args, rows: 0, error: 'unknown tool' });
    return JSON.stringify({ error: `Unknown tool "${call.name}"` });
  }
  trail.lookedUp.add(tool.label(call.args));
  try {
    const out = compactForAi(await tool.run(call.args, roUser));
    trail.log.push({ name: call.name, args: call.args, rows: out.rows });
    return out.text;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.info({ tool: call.name, err: message }, 'ai-chat tool error');
    trail.log.push({ name: call.name, args: call.args, rows: 0, error: message });
    return JSON.stringify({ error: message });
  }
}

export async function converse(
  provider: ChatProvider,
  input: { question: string; history: AiChatTurn[]; files: AiChatFile[] },
  roUser: AuthContext,
  trail: ToolTrail,
  deadline: number,
): Promise<ConversationResult> {
  const system = buildSystemPrompt();
  const turns = startTurns(input.history, input.question, input.files);
  let inputTokens = 0;
  let outputTokens = 0;
  for (let round = 0; ; round++) {
    const toolMode = round < MAX_TOOL_ROUNDS ? 'auto' : 'none';
    const reply = await provider.send({
      system,
      turns,
      tools: AI_TOOL_SPECS,
      toolMode,
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    inputTokens += reply.inputTokens;
    outputTokens += reply.outputTokens;
    if (reply.toolCalls.length === 0 || toolMode === 'none') {
      return { text: reply.text, model: reply.model, inputTokens, outputTokens };
    }
    turns.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
    const results: ToolResult[] = [];
    // One at a time: each runs its own read-only transaction.
    for (const call of reply.toolCalls) {
      results.push({
        id: call.id,
        name: call.name,
        content: await runToolCall(call, roUser, trail),
      });
    }
    turns.push({ role: 'tool', results });
  }
}
