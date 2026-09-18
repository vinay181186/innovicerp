import type { FastifyPluginAsync } from 'fastify';
import { and, eq, lt, sql, isNull } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { db } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { AppError, ValidationError } from '../lib/errors';

// ADR-172 — Idempotency keys for write requests (migration 0135).
//
// Twice in the 2026-09-17 verification run one click on Save took 14–20 s,
// the connection dropped, the browser resent the request, and the second copy
// failed with "already exists" although the first copy had created the
// document. The web app now sends a random `Idempotency-Key` header on every
// POST / PUT / PATCH / DELETE (apps/web/src/lib/api.ts). This plugin:
//
//   preHandler  — claims (user, key) with INSERT ... ON CONFLICT DO NOTHING.
//                 Claimed → the handler runs as normal. Not claimed → this is
//                 a repeat: wait for the first run to finish (poll every
//                 500 ms, up to 25 s) and answer with its stored result.
//   onSend      — for the run that claimed the row: store status + JSON body
//                 and mark it complete. 4xx is a legitimate result (the repeat
//                 must see the same failure); 5xx deletes the row so a genuine
//                 retry can run the handler again.
//   onResponse  — safety net for the one path that skips onSend (Fastify's
//                 last-resort fallback when the error handler itself throws):
//                 finalise the row from the status code alone so a repeat is
//                 never left polling a row nobody will ever complete.
//
// Fastify 5 lifecycle, verified in lib/reply.js: an error thrown anywhere
// (preHandler, handler) goes onError → setErrorHandler → reply.send → onSend.
// So onSend DOES run for error responses; no onError hook is needed and one
// would in fact be wrong (it fires before the error handler picks the status,
// so it cannot tell a 409 "conflict" worth storing from a 500 worth dropping).
//
// The bookkeeping is never allowed to break the real request: every store
// call in onSend / onResponse is wrapped and logged at warn on failure.

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_KEY_LENGTH = 128;

export type IdempotencyClaim = {
  userId: string;
  key: string;
  method: string;
  path: string;
};

export type IdempotencyRecord = {
  id: string;
  method: string;
  path: string;
  statusCode: number | null;
  responseBody: unknown;
  completedAt: Date | null;
  createdAt: Date;
};

/**
 * Storage behind the plugin. The default talks to Postgres through drizzle;
 * tests supply an in-memory one so the lifecycle can be exercised without a
 * database.
 */
export interface IdempotencyStore {
  /** INSERT ... ON CONFLICT (user_id, key) DO NOTHING RETURNING id. Null when the row already exists. */
  claim(input: IdempotencyClaim): Promise<string | null>;
  /** The existing row for (user, key), or null if it has been deleted. */
  find(userId: string, key: string): Promise<IdempotencyRecord | null>;
  /** Store the result and stamp completed_at. */
  complete(id: string, statusCode: number, responseBody: unknown): Promise<void>;
  /** Drop the row so the next request with the same key runs the handler again. */
  remove(id: string): Promise<void>;
  /** Drop an ABANDONED claim (never completed) so the key can be claimed again.
   *  No-op when the row has meanwhile been completed. */
  removeIfIncomplete(id: string): Promise<void>;
  /** Purge rows older than one day. */
  purge(): Promise<void>;
}

export const drizzleIdempotencyStore: IdempotencyStore = {
  async claim(input) {
    const rows = await db
      .insert(idempotencyKeys)
      .values({ userId: input.userId, key: input.key, method: input.method, path: input.path })
      .onConflictDoNothing({ target: [idempotencyKeys.userId, idempotencyKeys.key] })
      .returning({ id: idempotencyKeys.id });
    return rows[0]?.id ?? null;
  },
  async find(userId, key) {
    const rows = await db
      .select({
        id: idempotencyKeys.id,
        method: idempotencyKeys.method,
        path: idempotencyKeys.path,
        statusCode: idempotencyKeys.statusCode,
        responseBody: idempotencyKeys.responseBody,
        completedAt: idempotencyKeys.completedAt,
        createdAt: idempotencyKeys.createdAt,
      })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
      .limit(1);
    return rows[0] ?? null;
  },
  async complete(id, statusCode, responseBody) {
    await db
      .update(idempotencyKeys)
      .set({ statusCode, responseBody, completedAt: sql`now()` })
      .where(eq(idempotencyKeys.id, id));
  },
  async removeIfIncomplete(id) {
    await db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.id, id), isNull(idempotencyKeys.completedAt)));
  },
  async remove(id) {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
  },
  async purge() {
    await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, sql`now() - interval '1 day'`));
  },
};

export type IdempotencyPluginOptions = {
  store?: IdempotencyStore;
  /** How often a repeat re-checks the first run (default 500 ms). */
  pollIntervalMs?: number;
  /** How long a repeat waits for the first run before giving up with 409 (default 25 s). */
  waitMs?: number;
  /** A claim older than this with no result is treated as abandoned and reclaimed. */
  staleAfterMs?: number;
  /** How often old rows are purged (default 10 min). */
  purgeIntervalMs?: number;
};

type IdempotencyState = {
  rowId: string;
  /** Set once the row has been completed or removed, so onResponse does not touch it again. */
  done: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only on the request that claimed the (user, key) row. */
    idempotency: IdempotencyState | null;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isStreamLike = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as { pipe?: unknown }).pipe === 'function';

/** The stored body: parsed JSON for a JSON string payload. Returns
 *  `undefined` (not null — JSON `null` is a legitimate body) when the payload
 *  is not JSON, so the caller drops the row instead of replaying an empty
 *  body for a text/csv/html response. */
const NOT_JSON = Symbol('not-json');
const bodyToStore = (payload: unknown, contentType: unknown): unknown | typeof NOT_JSON => {
  if (payload === undefined || payload === null || payload === '') return null;
  if (typeof payload !== 'string') return NOT_JSON;
  const ct = typeof contentType === 'string' ? contentType : '';
  if (ct && !ct.toLowerCase().includes('application/json')) return NOT_JSON;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return NOT_JSON;
  }
};

const readKey = (raw: string | string[] | undefined): string => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').trim();
};

const idempotencyPluginImpl: FastifyPluginAsync<IdempotencyPluginOptions> = async (app, opts) => {
  const store = opts.store ?? drizzleIdempotencyStore;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const waitMs = opts.waitMs ?? 25_000;
  // A claim older than this with no result is abandoned (see preHandler).
  const staleAfterMs = opts.staleAfterMs ?? waitMs + 5_000;
  const purgeIntervalMs = opts.purgeIntervalMs ?? 10 * 60 * 1000;

  app.decorateRequest('idempotency', null);

  app.addHook('preHandler', async (req, reply) => {
    if (!WRITE_METHODS.has(req.method)) return;
    const key = readKey(req.headers['idempotency-key']);
    if (!key) return;
    if (key.length > MAX_KEY_LENGTH) {
      throw new ValidationError(
        `Idempotency-Key header must be ${MAX_KEY_LENGTH} characters or fewer`,
      );
    }
    if (!req.user) return;

    const userId = req.user.id;
    const method = req.method;
    const path = req.url;
    const deadline = Date.now() + waitMs;

    for (;;) {
      // Fail OPEN: the bookkeeping must never break the real request. If the
      // table is missing (migration 0135 not yet applied on this database) or
      // the store blips, log and run the handler as if no key had been sent.
      let rowId: string | null;
      try {
        rowId = await store.claim({ userId, key, method, path });
      } catch (err) {
        req.log.warn({ err }, 'idempotency: claim failed — running without idempotency');
        req.idempotency = null;
        return;
      }
      if (rowId) {
        req.idempotency = { rowId, done: false };
        return;
      }

      // Somebody already holds this key — it is a repeat of an earlier request.
      let existing: IdempotencyRecord | null;
      try {
        existing = await store.find(userId, key);
      } catch (err) {
        req.log.warn({ err }, 'idempotency: find failed — running without idempotency');
        req.idempotency = null;
        return;
      }
      if (existing) {
        if (existing.method !== method || existing.path !== path) {
          throw new AppError(
            422,
            'idempotency_key_reused',
            'Idempotency-Key reused for a different request',
          );
        }
        if (existing.completedAt && existing.statusCode !== null) {
          req.log.info(
            { idempotencyKey: key, statusCode: existing.statusCode },
            'idempotency: replaying stored response',
          );
          reply.header('idempotent-replayed', 'true');
          if (existing.responseBody === null || existing.statusCode === 204) {
            return reply.code(existing.statusCode).send();
          }
          return reply
            .code(existing.statusCode)
            .type('application/json; charset=utf-8')
            .send(JSON.stringify(existing.responseBody));
        }
        // Claimed but never completed, and older than any request could still
        // be running: the process that claimed it died mid-handler (restart,
        // OOM) — which is exactly what makes a browser resend a request. Drop
        // the abandoned claim and loop to take it over, instead of waiting the
        // full window and then telling the user "still being processed".
        if (Date.now() - existing.createdAt.getTime() > staleAfterMs) {
          req.log.warn(
            { idempotencyKey: key, rowId: existing.id },
            'idempotency: reclaiming an abandoned claim',
          );
          try {
            await store.removeIfIncomplete(existing.id);
          } catch (err) {
            req.log.warn({ err }, 'idempotency: reclaim failed — running without idempotency');
            req.idempotency = null;
            return;
          }
          continue;
        }
      }
      // Either the first run is still going (row present, not completed) or it
      // just failed with a 5xx and dropped its row (row gone — the next claim
      // will succeed and run the handler afresh). Wait a beat and look again.
      if (Date.now() >= deadline) {
        throw new AppError(
          409,
          'in_progress',
          'This request is still being processed — please wait a moment and refresh',
        );
      }
      await sleep(pollIntervalMs);
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const state = req.idempotency;
    if (!state || state.done) return payload;
    state.done = true;
    try {
      const statusCode = reply.statusCode;
      if (statusCode >= 500) {
        // A server error is not a result worth replaying — let the retry run.
        await store.remove(state.rowId);
      } else if (Buffer.isBuffer(payload) || isStreamLike(payload)) {
        // A file / stream cannot be replayed from a jsonb column; drop the row
        // so a repeat regenerates it (exports have no side effects).
        await store.remove(state.rowId);
      } else {
        const body = bodyToStore(payload, reply.getHeader('content-type'));
        if (body === NOT_JSON) {
          // text / csv / html cannot be replayed from jsonb — let a repeat regenerate it.
          await store.remove(state.rowId);
        } else {
          await store.complete(state.rowId, statusCode, body);
        }
      }
    } catch (err) {
      req.log.warn({ err, rowId: state.rowId }, 'idempotency: failed to store result');
    }
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const state = req.idempotency;
    if (!state || state.done) return;
    state.done = true;
    try {
      if (reply.statusCode >= 500) await store.remove(state.rowId);
      else await store.complete(state.rowId, reply.statusCode, null);
    } catch (err) {
      req.log.warn({ err, rowId: state.rowId }, 'idempotency: failed to finalise row');
    }
  });

  const purgeTimer = setInterval(() => {
    store.purge().catch((err: unknown) => {
      app.log.warn({ err }, 'idempotency: purge failed');
    });
  }, purgeIntervalMs);
  purgeTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(purgeTimer);
  });
};

export const idempotencyPlugin = fp(idempotencyPluginImpl, { name: 'idempotency' });
