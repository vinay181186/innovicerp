// Boot wiring for the alerts BullMQ worker (T-041d Phase B slice 6,
// ADR-024). Imported from server.ts AFTER app.listen so worker startup
// failures don't block the api process.
//
// Three env-var gates control activation (see lib/queue.ts):
//   REDIS_URL              required for any BullMQ operation
//   ALERTS_PUSH_ENABLED    must be true to register the 30-min schedule
//   RESEND_API_KEY         required for real email sends (otherwise
//                          dispatch is logged-not-sent, audit row still
//                          recorded with a `stub-` message_id)
//
// Without REDIS_URL the worker doesn't start at all — runDigestTick can
// still be invoked manually (tests, ops drill) but no scheduled tick fires.

import type { Job, Worker } from 'bullmq';
import { buildAlertsWorker, registerAlertSchedule } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { runDigestTick } from './worker';

let worker: Worker | undefined;

interface DigestJobPayload {
  source?: string;
}

async function processDigest(job: Job<DigestJobPayload>): Promise<unknown> {
  logger.info({ jobId: job.id, source: job.data.source }, 'alerts worker: tick start');
  try {
    const result = await runDigestTick();
    logger.info({ jobId: job.id, ...result }, 'alerts worker: tick complete');
    return result;
  } catch (err) {
    logger.error({ jobId: job.id, err }, 'alerts worker: tick failed (BullMQ will retry)');
    throw err;
  }
}

/** Boot the worker. Idempotent — calling twice is a no-op (sets up once). */
export async function startAlertsWorker(): Promise<void> {
  if (worker) return;
  const w = buildAlertsWorker(processDigest);
  if (!w) {
    // Stub mode (no Redis) — log was already emitted by getAlertsQueue.
    return;
  }
  worker = w;
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'alerts worker: job failed');
  });
  worker.on('error', (err) => {
    logger.error({ err }, 'alerts worker: connection error');
  });
  await worker.run();
  await registerAlertSchedule();
  logger.info('alerts worker started + schedule registered');
}

/** Tear-down hook for graceful shutdown. */
export async function stopAlertsWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
