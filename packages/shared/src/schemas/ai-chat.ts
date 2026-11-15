// AI Chat (ADR-293) — the one contract between the chat panel and POST /ai-chat.
//
// L6 Super Admin only. The chat READS live ERP data through the ERP's own read
// services and never writes ERP data; the only row it stores is its own log
// (ai_chat_log, migration 0252).

import { z } from 'zod';

/** What the person picks in the chat's Model box. Auto = Claude, then Gemini
 *  only when Claude's credit is finished. */
export const AI_CHAT_MODELS = ['auto', 'claude', 'gemini'] as const;
export const aiChatModelSchema = z.enum(AI_CHAT_MODELS);
export type AiChatModel = z.infer<typeof aiChatModelSchema>;

export const AI_CHAT_PROVIDERS = ['claude', 'gemini'] as const;
export type AiChatProvider = (typeof AI_CHAT_PROVIDERS)[number];

/** How a question ended — the log's `outcome`. */
export const AI_CHAT_OUTCOMES = ['ok', 'refused', 'no_credit', 'limit', 'error'] as const;
export type AiChatOutcome = (typeof AI_CHAT_OUTCOMES)[number];

export const AI_CHAT_QUESTION_MAX = 1000;
export const AI_CHAT_HISTORY_MAX = 10;
export const AI_CHAT_FILES_MAX = 3;
/** Per attached PDF (owner 2026-11-15: 3 files, 5 MB each). */
export const AI_CHAT_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** Per image: Claude takes at most 5 MB of base64 per image (≈3.7 MB of file). */
export const AI_CHAT_IMAGE_MAX_BYTES = 3.5 * 1024 * 1024;
/** All files of one question together: Gemini takes about 20 MB per request
 *  inline, and base64 grows the files by a third. */
export const AI_CHAT_FILES_TOTAL_MAX_BYTES = 12 * 1024 * 1024;

/** The most one file of this type may weigh. */
export function aiChatFileMaxBytes(type: string): number {
  return type === 'application/pdf' ? AI_CHAT_FILE_MAX_BYTES : AI_CHAT_IMAGE_MAX_BYTES;
}
export const AI_CHAT_FILE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export const aiChatFileTypeSchema = z.enum(AI_CHAT_FILE_TYPES);

/** base64 grows 4/3 — the encoded length that still fits `bytes`. */
const b64Max = (bytes: number): number => Math.ceil(bytes / 3) * 4;

export const aiChatFileSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: aiChatFileTypeSchema,
    /** Raw base64, no `data:` prefix. */
    data: z.string().min(1),
  })
  .refine((f) => f.data.length <= b64Max(aiChatFileMaxBytes(f.type)), {
    message: 'File is too big (image up to 3.5 MB, PDF up to 5 MB)',
    path: ['data'],
  });
export type AiChatFile = z.infer<typeof aiChatFileSchema>;

export const aiChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(8000),
});
export type AiChatTurn = z.infer<typeof aiChatTurnSchema>;

export const aiChatRequestSchema = z
  .object({
    model: aiChatModelSchema,
    question: z.string().trim().max(AI_CHAT_QUESTION_MAX).default(''),
    /** Earlier turns of this panel session, oldest first (text only). */
    history: z.array(aiChatTurnSchema).max(AI_CHAT_HISTORY_MAX).default([]),
    files: z
      .array(aiChatFileSchema)
      .max(AI_CHAT_FILES_MAX)
      .default([])
      .refine(
        (fs) => fs.reduce((n, f) => n + f.data.length, 0) <= b64Max(AI_CHAT_FILES_TOTAL_MAX_BYTES),
        { message: 'All files together must be under 12 MB' },
      ),
  })
  .refine((v) => v.question.length > 0 || v.files.length > 0, {
    message: 'Type a question or attach a file',
    path: ['question'],
  });
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export interface AiChatResponse {
  /** Plain text; lists come as GitHub-style pipe tables. */
  answer: string;
  outcome: AiChatOutcome;
  providerUsed: AiChatProvider | null;
  model: string | null;
  /** One-line note shown above the answer, e.g. Auto fell back to Gemini. */
  notice?: string;
  /** Plain names of what was looked up ("Purchase Orders list"). */
  lookedUp: string[];
  /** Questions asked today (company-wide count of this person's log rows). */
  usedToday: number;
  dailyLimit: number;
}

/** GET /ai-chat/usage — for the "n of 100 today" line when the panel opens. */
export interface AiChatUsage {
  usedToday: number;
  dailyLimit: number;
}
