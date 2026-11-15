// Ask ERP session state (ADR-293). Kept in the launcher, so closing the panel keeps
// the conversation; a reload clears it (nothing is stored in the browser).

import {
  AI_CHAT_HISTORY_MAX,
  type AiChatModel,
  type AiChatResponse,
  type AiChatTurn,
} from '@innovic/shared';

export type ChatReply =
  | { kind: 'answer'; res: AiChatResponse; picked: AiChatModel; at: number }
  | { kind: 'failed'; message: string };

export interface ChatExchange {
  id: string;
  question: string;
  fileNames: string[];
  /** null while the server is still answering. */
  reply: ChatReply | null;
}

const TURN_MAX = 8000;

/** The last AI_CHAT_HISTORY_MAX turns that got a real answer, oldest first. */
export function buildHistory(exchanges: ChatExchange[]): AiChatTurn[] {
  const turns = exchanges.flatMap((e): AiChatTurn[] => {
    const r = e.reply;
    if (r?.kind !== 'answer' || (r.res.outcome !== 'ok' && r.res.outcome !== 'refused')) return [];
    const asked = e.question || `Attached: ${e.fileNames.join(', ')}`;
    return [
      { role: 'user', text: asked.slice(0, TURN_MAX) },
      { role: 'assistant', text: r.res.answer.slice(0, TURN_MAX) },
    ];
  });
  return turns.slice(-AI_CHAT_HISTORY_MAX);
}

export const MODEL_OPTIONS: ReadonlyArray<{ value: AiChatModel; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
];

export const MODEL_HELP: Record<AiChatModel, string> = {
  auto: 'Auto: Claude first; if Claude credit is finished, Gemini (free tier) answers.',
  claude: 'Claude only: uses your monthly Claude credit. When it is finished you get a message.',
  gemini: 'Gemini only: free tier. When the free quota is used up you get a message.',
};
