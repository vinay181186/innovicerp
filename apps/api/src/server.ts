import type { MeResponse } from '@innovic/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { pingDatabase } from './db/client';
import { resolveCorsOrigin } from './lib/cors';
import { env } from './lib/env';
import { AuthenticationError } from './lib/errors';
import { logger } from './lib/logger';
import { initSentry } from './lib/sentry';
import { activityLogRoutes } from './modules/activity-log/routes';
import { alertsRoutes } from './modules/alerts/routes';
import { startAlertsWorker, stopAlertsWorker } from './modules/alerts/worker-boot';
import { bomMasterRoutes } from './modules/bom-master/routes';
import { clientsRoutes } from './modules/clients/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { deliveryChallansRoutes } from './modules/delivery-challans/routes';
import { itemsRoutes } from './modules/items/routes';
import { jobCardsRoutes } from './modules/job-cards/routes';
import { jobWorkOrdersRoutes } from './modules/job-work-orders/routes';
import { machinesRoutes } from './modules/machines/routes';
import { ncRegisterRoutes } from './modules/nc-register/routes';
import { opEntryRoutes } from './modules/op-entry/routes';
import { goodsReceiptNotesRoutes } from './modules/goods-receipt-notes/routes';
import { operatorsRoutes } from './modules/operators/routes';
import { purchaseOrdersRoutes } from './modules/purchase-orders/routes';
import { purchaseRequestsRoutes } from './modules/purchase-requests/routes';
import { costCentersRoutes } from './modules/cost-centers/routes';
import { qcDashboardRoutes } from './modules/qc-dashboard/routes';
import { qcProcessesRoutes } from './modules/qc-processes/routes';
import { reportsRoutes } from './modules/reports/routes';
import { routeCardRoutes } from './modules/route-cards/routes';
import { savedReportsRoutes } from './modules/saved-reports/routes';
import { storeTransactionsRoutes } from './modules/store-transactions/routes';
import { salesOrdersRoutes } from './modules/sales-orders/routes';
import { vendorsRoutes } from './modules/vendors/routes';
import { authPlugin } from './plugins/auth';
import { errorHandlerPlugin } from './plugins/error-handler';

initSentry();

const app = Fastify({
  loggerInstance: logger,
  trustProxy: true,
  disableRequestLogging: false,
});

await app.register(helmet);
await app.register(cors, {
  origin: resolveCorsOrigin(),
  credentials: true,
});
await app.register(sensible);
await app.register(errorHandlerPlugin);
await app.register(authPlugin);

// Liveness probe — used by Railway's healthcheck. ALWAYS returns 200 if
// the server is responding. Doesn't depend on downstream services so a
// Supabase blip can't roll back a Railway deploy. Standard k8s split.
//
// Previous behaviour (returning 503 on DB outage) caused the deploy
// failures captured in screenshot ER1_08-05-26 — cold-start /health
// timed out → Railway healthcheck fail → rollback. See `/readyz` for
// the DB-aware variant used by monitoring tools (Better Stack etc.).
app.get('/health', async () => ({
  ok: true,
  env: env.NODE_ENV,
  version: '0.0.0',
  gitSha: env.GIT_SHA ?? null,
  timestamp: new Date().toISOString(),
}));

// Readiness probe — DB-aware. 503 when the DB ping fails or times out.
// Use this in Better Stack / external uptime monitoring; do NOT wire to
// the platform healthcheck or you re-introduce the deploy-rollback bug.
app.get('/readyz', async (_req, reply) => {
  const dbStatus = await pingDatabase();
  reply.code(dbStatus.ok ? 200 : 503);
  return {
    ok: dbStatus.ok,
    db: dbStatus.ok ? 'up' : 'down',
    ...(dbStatus.ok ? {} : { dbError: dbStatus.error }),
    env: env.NODE_ENV,
    version: '0.0.0',
    gitSha: env.GIT_SHA ?? null,
    timestamp: new Date().toISOString(),
  };
});

app.get('/me', async (req): Promise<MeResponse> => {
  if (!req.user) throw new AuthenticationError();
  return req.user;
});

await app.register(itemsRoutes);
await app.register(clientsRoutes);
await app.register(vendorsRoutes);
await app.register(machinesRoutes);
await app.register(operatorsRoutes);
await app.register(opEntryRoutes);
await app.register(salesOrdersRoutes);
await app.register(jobWorkOrdersRoutes);
await app.register(jobCardsRoutes);
await app.register(purchaseRequestsRoutes);
await app.register(purchaseOrdersRoutes);
await app.register(goodsReceiptNotesRoutes);
await app.register(storeTransactionsRoutes);
await app.register(ncRegisterRoutes);
await app.register(deliveryChallansRoutes);
await app.register(dashboardRoutes);
await app.register(qcDashboardRoutes);
await app.register(reportsRoutes);
await app.register(savedReportsRoutes);
await app.register(activityLogRoutes);
await app.register(alertsRoutes);
await app.register(bomMasterRoutes);
await app.register(routeCardRoutes);
await app.register(qcProcessesRoutes);
await app.register(costCentersRoutes);

try {
  await app.listen({ port: env.PORT ?? env.API_PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
}

// Alerts BullMQ worker — boots AFTER app.listen so a worker startup failure
// (missing Redis, bad Resend creds) doesn't roll back the api deploy.
// Without REDIS_URL the worker stays in stub mode and this is a quiet no-op.
try {
  await startAlertsWorker();
} catch (err) {
  logger.error({ err }, 'alerts worker failed to start; api stays up');
}

process.on('SIGTERM', () => {
  void (async () => {
    logger.info('SIGTERM received — shutting down alerts worker + http server');
    try {
      await stopAlertsWorker();
      await app.close();
    } finally {
      process.exit(0);
    }
  })();
});
