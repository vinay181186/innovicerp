import type { MeResponse } from '@innovic/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { env } from './lib/env';
import { AuthenticationError } from './lib/errors';
import { logger } from './lib/logger';
import { clientsRoutes } from './modules/clients/routes';
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
import { storeTransactionsRoutes } from './modules/store-transactions/routes';
import { salesOrdersRoutes } from './modules/sales-orders/routes';
import { vendorsRoutes } from './modules/vendors/routes';
import { authPlugin } from './plugins/auth';
import { errorHandlerPlugin } from './plugins/error-handler';

const app = Fastify({
  loggerInstance: logger,
  trustProxy: true,
  disableRequestLogging: false,
});

await app.register(helmet);
await app.register(cors, { origin: true, credentials: true });
await app.register(sensible);
await app.register(errorHandlerPlugin);
await app.register(authPlugin);

app.get('/health', async () => ({
  ok: true,
  env: env.NODE_ENV,
  version: '0.0.0',
  gitSha: env.GIT_SHA ?? null,
  timestamp: new Date().toISOString(),
}));

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

try {
  await app.listen({ port: env.PORT ?? env.API_PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
}
