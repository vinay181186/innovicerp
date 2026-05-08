// BullMQ + Redis client wrapper for the alerts push delivery worker
// (T-041d Phase B, ADR-024). Three flags control behaviour:
//
//   REDIS_URL              — required for any BullMQ operation. If unset
//                            we run in "stub mode": getQueue() / getWorker()
//                            return undefined, enqueue helpers no-op.
//   ALERTS_PUSH_ENABLED    — gate on the repeatable scheduler. Even with
//                            REDIS_URL present, the cron tick is only
//                            registered when this is true.
//   (worker function itself lives in modules/alerts/worker.ts when slice
//    6 lands; this module just exposes the connection + queue.)
//
// Design choices:
//   - One process boots both the Fastify api AND the worker (same Node
//     container). For 15-100 users this is fine; we can split later if
//     queue throughput demands it (would only require extracting the
//     worker boot path into a dedicated entrypoint).
//   - Dual ConnectionOptions (queue + worker) per BullMQ docs — sharing
//     one ioredis instance across both is unsafe with the worker's
//     blocking calls. Each gets its own client.
//   - Maxretries + backoff are global defaults; per-job overrides land
//     when the alerts worker is wired in slice 6.

import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const ALERTS_QUEUE_NAME = 'alerts';
export const ALERTS_DIGEST_JOB = 'alerts:digest';

/** Build a Redis connection if REDIS_URL is set. Cached on the module
 *  so imports share the connection. Returns undefined in stub mode. */
let redisQueueClient: Redis | undefined;
let redisWorkerClient: Redis | undefined;

function buildRedis(): Redis {
  // BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
  // for blocking commands used by Worker.
  return new IORedis(env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function getRedisForQueue(): Redis | undefined {
  if (!env.REDIS_URL) return undefined;
  if (!redisQueueClient) redisQueueClient = buildRedis();
  return redisQueueClient;
}

export function getRedisForWorker(): Redis | undefined {
  if (!env.REDIS_URL) return undefined;
  if (!redisWorkerClient) redisWorkerClient = buildRedis();
  return redisWorkerClient;
}

let alertsQueue: Queue | undefined;
let warnedNoRedis = false;

/** Returns the alerts BullMQ queue, or undefined in stub mode. */
export function getAlertsQueue(): Queue | undefined {
  if (!env.REDIS_URL) {
    if (!warnedNoRedis) {
      logger.warn(
        'REDIS_URL not set — alerts push queue running in stub mode (no jobs scheduled, no jobs dispatched). Set REDIS_URL + ALERTS_PUSH_ENABLED=true to enable.',
      );
      warnedNoRedis = true;
    }
    return undefined;
  }
  if (!alertsQueue) {
    const connection = getRedisForQueue();
    if (!connection) return undefined;
    alertsQueue = new Queue(ALERTS_QUEUE_NAME, {
      connection: connection as ConnectionOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return alertsQueue;
}

/** Enqueue a one-off digest evaluation. No-op in stub mode. */
export async function enqueueAlertEvaluation(
  payload: Record<string, unknown>,
  opts?: JobsOptions,
): Promise<string | undefined> {
  const q = getAlertsQueue();
  if (!q) return undefined;
  const job = await q.add(ALERTS_DIGEST_JOB, payload, opts);
  return job.id;
}

/** Register the repeatable scheduler that fires every 30 minutes. Idempotent
 *  by job name — calling twice does NOT duplicate the schedule. Only
 *  registered when REDIS_URL set AND ALERTS_PUSH_ENABLED=true. */
export async function registerAlertSchedule(): Promise<void> {
  if (!env.ALERTS_PUSH_ENABLED) {
    logger.info('ALERTS_PUSH_ENABLED=false — alerts schedule not registered.');
    return;
  }
  const q = getAlertsQueue();
  if (!q) return;
  await q.add(
    ALERTS_DIGEST_JOB,
    { source: 'schedule' },
    {
      // Every 30 minutes on the half-hour.
      repeat: { pattern: '0,30 * * * *' },
      jobId: 'alerts-digest-repeat',
    },
  );
  logger.info('Registered alerts digest schedule (every 30 minutes).');
}

/** Build a Worker instance. The processor is supplied by the caller so this
 *  module stays free of business logic. Returns undefined in stub mode. */
export function buildAlertsWorker<T = unknown>(processor: Processor<T>): Worker<T> | undefined {
  if (!env.REDIS_URL) return undefined;
  const connection = getRedisForWorker();
  if (!connection) return undefined;
  return new Worker<T>(ALERTS_QUEUE_NAME, processor, {
    connection: connection as ConnectionOptions,
    // Don't auto-run; caller starts via worker.run() so boot is explicit.
    autorun: false,
    concurrency: 1,
  });
}

/** Tear-down hook for graceful shutdown / tests. */
export async function closeAlertsQueue(): Promise<void> {
  if (alertsQueue) {
    await alertsQueue.close();
    alertsQueue = undefined;
  }
  if (redisQueueClient) {
    await redisQueueClient.quit();
    redisQueueClient = undefined;
  }
  if (redisWorkerClient) {
    await redisWorkerClient.quit();
    redisWorkerClient = undefined;
  }
}
