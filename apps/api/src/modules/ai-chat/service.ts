// ADR-293 — AI Chat: super-admin, read-only questions about live ERP data.
// The AI only sees what the allow-listed tools (tools.ts) return, read through
// the ERP's own services in READ ONLY transactions. The one row this feature
// writes is its own ai_chat_log entry.
import type {
  AiChatOutcome,
  AiChatProvider,
  AiChatRequest,
  AiChatResponse,
  AiChatUsage,
} from '@innovic/shared';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { aiChatLog } from '../../db/schema';
import { type AuthContext, readOnlyUserContext, withUserContext } from '../../db/with-user-context';
import { env } from '../../lib/env';
import { ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { type ConversationResult, converse, type ToolTrail } from './conversation';
import { REFUSE_NOT_ERP, REFUSE_WRITE_PREFIX } from './prompt';
import { claudeProvider } from './providers/claude';
import { geminiProvider } from './providers/gemini';
import { type ChatProvider, ProviderError, type ProviderFailureKind } from './providers/types';

/** The whole question — every provider call and tool — stays within this. */
const QUESTION_BUDGET_MS = 60_000;
const ERROR_LOG_MAX = 1000;

const MSG = {
  claudeNoCredit:
    'Claude credit for this month is finished. Pick Gemini or Auto in the Model box to keep asking.',
  geminiNoQuota:
    'The Gemini free quota is used up for today. Pick Claude or Auto in the Model box, or try again tomorrow.',
  bothNoCredit:
    'Claude credit is finished and the Gemini free quota is used up for today. Try again tomorrow.',
  fellBack: 'Claude credit for this month is finished — answered by Gemini (free tier).',
  fellBackNotSetUp: 'Claude is not set up — answered by Gemini (free tier).',
  claudeNotSetUp: 'Claude is not set up: ANTHROPIC_API_KEY is missing in Railway.',
  busy: 'The AI is busy right now (too many requests a minute). Please ask again in a minute.',
  geminiNotSetUp: 'Gemini is not set up: GEMINI_API_KEY is missing in Railway.',
  noneSetUp:
    'The AI chat is not set up: ANTHROPIC_API_KEY and GEMINI_API_KEY are missing in Railway.',
  error: 'The AI could not answer just now. Please ask again.',
  empty: 'No answer came back. Please ask again.',
};

const PROVIDERS: Record<AiChatProvider, ChatProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
};

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new ValidationError('Your login has no company.');
  return user.companyId;
}

// ---- usage (the daily limit) -------------------------------------------------

let warnedNoTable = false;
function isMissingTable(e: unknown): boolean {
  const o = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return o?.code === '42P01' || o?.cause?.code === '42P01';
}

/** This person's questions since midnight IST. A 'limit' or 'no_credit' row
 *  is not a question answered, so it does not use up the day's count. */
function countTodayIn(tx: DbTransaction, user: AuthContext, companyId: string) {
  return tx
    .select({ n: sql<number>`count(*)::int` })
    .from(aiChatLog)
    .where(
      and(
        eq(aiChatLog.companyId, companyId),
        eq(aiChatLog.userId, user.id),
        isNull(aiChatLog.deletedAt),
        notInArray(aiChatLog.outcome, ['limit', 'no_credit']),
        sql`${aiChatLog.askedAt} >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`,
      ),
    )
    .then((rows) => rows[0]?.n ?? 0);
}

function warnNoTable(): void {
  if (!warnedNoTable) {
    warnedNoTable = true;
    logger.warn('ai_chat_log table missing (migration 0252 not applied) — usage counts as 0');
  }
}

async function countToday(user: AuthContext, companyId: string): Promise<number> {
  try {
    return await withUserContext(readOnlyUserContext(user), (tx) =>
      countTodayIn(tx, user, companyId),
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    warnNoTable();
    return 0;
  }
}

/** CLAUDE.md §20.3 — the daily cap is checked and the question's row is
 *  reserved ('pending') in ONE transaction under this person's advisory lock,
 *  so two tabs at 99 of 100 cannot both get through. Returns the reserved row
 *  id, or null when the cap is reached. No table yet → no reservation. */
async function reserve(
  user: AuthContext,
  companyId: string,
  input: AiChatRequest,
  limit: number,
): Promise<{ used: number; rowId: string | null; capped: boolean }> {
  try {
    return await withUserContext(user, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ai-chat:' + user.id}))`);
      const used = await countTodayIn(tx, user, companyId);
      if (used >= limit) return { used, rowId: null, capped: true };
      const [row] = await tx
        .insert(aiChatLog)
        .values({
          companyId,
          userId: user.id,
          question: input.question,
          modelChoice: input.model,
          outcome: 'pending',
          files: fileMeta(input),
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: aiChatLog.id });
      return { used, rowId: row?.id ?? null, capped: false };
    });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    warnNoTable();
    return { used: 0, rowId: null, capped: false };
  }
}

/** Name, type and size only — never the file content. */
function fileMeta(input: AiChatRequest) {
  return input.files.map((f) => ({
    name: f.name,
    type: f.type,
    bytes: Math.floor((f.data.length * 3) / 4),
  }));
}

export async function getAiChatUsage(user: AuthContext): Promise<AiChatUsage> {
  const companyId = requireCompany(user);
  return { usedToday: await countToday(user, companyId), dailyLimit: env.AI_CHAT_DAILY_LIMIT };
}

// ---- the log ----------------------------------------------------------------

interface LogRow {
  outcome: AiChatOutcome;
  answer: string;
  providerUsed: AiChatProvider | null;
  model: string | null;
  error?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

async function writeLog(
  user: AuthContext,
  companyId: string,
  input: AiChatRequest,
  trail: ToolTrail,
  row: LogRow,
  startedAt: number,
  rowId: string | null,
): Promise<void> {
  const result = {
    providerUsed: row.providerUsed,
    model: row.model,
    toolsUsed: trail.log,
    answer: row.answer,
    outcome: row.outcome,
    error: row.error ? row.error.slice(0, ERROR_LOG_MAX) : null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    durationMs: Date.now() - startedAt,
    updatedBy: user.id,
  };
  try {
    // Its own ordinary (NOT read-only) transaction — the feature's one write.
    await withUserContext(user, async (tx) => {
      if (rowId) {
        await tx
          .update(aiChatLog)
          .set({ ...result, updatedAt: new Date() })
          .where(and(eq(aiChatLog.id, rowId), eq(aiChatLog.outcome, 'pending')));
        return;
      }
      await tx.insert(aiChatLog).values({
        ...result,
        companyId,
        userId: user.id,
        question: input.question,
        modelChoice: input.model,
        files: fileMeta(input),
        createdBy: user.id,
      });
    });
  } catch (e) {
    logger.warn({ err: e, userId: user.id }, 'ai-chat log write failed');
  }
}

// ---- asking -----------------------------------------------------------------

function isRefusal(text: string): boolean {
  return text.startsWith(REFUSE_NOT_ERP) || text.startsWith(REFUSE_WRITE_PREFIX);
}

/** The person-facing sentence for what went wrong, naming each provider
 *  that was tried and what happened to it. */
function failureMessage(fails: Array<{ provider: AiChatProvider; kind: ProviderFailureKind }>) {
  const kindOf = (p: AiChatProvider) => fails.find((f) => f.provider === p)?.kind;
  const c = kindOf('claude');
  const g = kindOf('gemini');
  if (c === 'no_credit' && g === 'no_credit') return MSG.bothNoCredit;
  if (c === 'not_configured' && g === 'not_configured') return MSG.noneSetUp;
  if (c === 'busy' || g === 'busy') return MSG.busy;
  if (c === 'error' || g === 'error') return MSG.error;
  if (c && g) {
    // Auto: Claude out (no credit / not set up), then Gemini out too.
    const claudePart =
      c === 'no_credit'
        ? 'Claude credit for this month is finished'
        : 'Claude is not set up (ANTHROPIC_API_KEY is missing in Railway)';
    const geminiPart =
      g === 'no_credit'
        ? 'the Gemini free quota is used up for today'
        : 'Gemini is not set up (GEMINI_API_KEY is missing in Railway)';
    return `${claudePart}, and ${geminiPart}.`;
  }
  if (c === 'no_credit') return MSG.claudeNoCredit;
  if (c === 'not_configured') return MSG.claudeNotSetUp;
  if (g === 'no_credit') return MSG.geminiNoQuota;
  return MSG.geminiNotSetUp;
}

export async function askAiChat(input: AiChatRequest, user: AuthContext): Promise<AiChatResponse> {
  const startedAt = Date.now();
  const companyId = requireCompany(user);
  const dailyLimit = env.AI_CHAT_DAILY_LIMIT;
  const trail: ToolTrail = { lookedUp: new Set(), log: [] };
  const { used, rowId, capped } = await reserve(user, companyId, input, dailyLimit);

  const finish = async (row: LogRow, notice?: string): Promise<AiChatResponse> => {
    await writeLog(user, companyId, input, trail, row, startedAt, rowId);
    const counts = row.outcome !== 'limit' && row.outcome !== 'no_credit';
    return {
      answer: row.answer,
      outcome: row.outcome,
      providerUsed: row.providerUsed,
      model: row.model,
      ...(notice ? { notice } : {}),
      lookedUp: [...trail.lookedUp],
      usedToday: used + (counts ? 1 : 0),
      dailyLimit,
    };
  };

  if (capped) {
    return finish({
      outcome: 'limit',
      answer: `${dailyLimit} of ${dailyLimit} questions used today. The chat opens again tomorrow.`,
      providerUsed: null,
      model: null,
    });
  }

  // 'auto' = Claude, then Gemini ONLY when Claude's credit is finished / not set up.
  const order: AiChatProvider[] = input.model === 'auto' ? ['claude', 'gemini'] : [input.model];
  const roUser = readOnlyUserContext(user);
  const deadline = startedAt + QUESTION_BUDGET_MS;
  const fails: Array<{ provider: AiChatProvider; kind: ProviderFailureKind; message: string }> = [];

  for (const name of order) {
    const provider = PROVIDERS[name];
    let result: ConversationResult;
    try {
      result = await converse(provider, input, roUser, trail, deadline);
    } catch (e) {
      if (!(e instanceof ProviderError)) {
        logger.error({ err: e, provider: name }, 'ai-chat failed');
        fails.push({ provider: name, kind: 'error', message: String(e) });
        break;
      }
      logger.warn({ provider: name, kind: e.kind, msg: e.message }, 'ai-chat provider failed');
      fails.push({ provider: name, kind: e.kind, message: e.message });
      // Only "no credit" / "not set up" falls back; busy and errors stop here.
      if (e.kind === 'error' || e.kind === 'busy') break;
      continue;
    }
    const text = result.text.trim();
    const claudeFail = fails.find((f) => f.provider === 'claude');
    const notice = claudeFail
      ? claudeFail.kind === 'not_configured'
        ? MSG.fellBackNotSetUp
        : MSG.fellBack
      : undefined;
    return finish(
      {
        outcome: !text ? 'error' : isRefusal(text) ? 'refused' : 'ok',
        answer: text || MSG.empty,
        providerUsed: name,
        model: result.model,
        ...(text ? {} : { error: 'empty answer' }),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      notice,
    );
  }

  // Not set up has no outcome of its own: it is an 'error' row.
  const outcome: AiChatOutcome = fails.some((f) => f.kind === 'error' || f.kind === 'busy')
    ? 'error'
    : fails.some((f) => f.kind === 'no_credit')
      ? 'no_credit'
      : 'error';
  return finish({
    outcome,
    answer: failureMessage(fails),
    providerUsed: null,
    model: null,
    error: fails.map((f) => `${f.provider}: ${f.kind} ${f.message}`).join(' | '),
  });
}
