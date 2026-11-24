// ADR-309 — task pop-ups (Web Push). Thin routes: validate, call service.
// The user is always req.user — never read from the body or the URL.

import {
  removePushSubscriptionInputSchema,
  savePushSubscriptionInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/push', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPushConfig(req.user);
  });

  app.post('/me/push/subscription', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = savePushSubscriptionInputSchema.parse(req.body);
    const ua = req.headers['user-agent'];
    return service.savePushSubscription(body, typeof ua === 'string' ? ua : null, req.user);
  });

  app.delete('/me/push/subscription', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = removePushSubscriptionInputSchema.parse(req.body);
    return service.removePushSubscription(body, req.user);
  });

  app.post('/me/push/test', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.sendTestPush(req.user);
  });
}
