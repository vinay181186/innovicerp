import type { MeResponse } from '@innovic/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { env } from './lib/env';
import { AuthenticationError } from './lib/errors';
import { logger } from './lib/logger';
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

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
}
