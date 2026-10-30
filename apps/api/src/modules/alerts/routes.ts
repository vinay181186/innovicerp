import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthenticationError } from '../../lib/errors';
import { listAlertsQuerySchema, runAlertQuerySchema } from '@innovic/shared';
import { pageAlertRecords, pageAlerts } from './paging';
import { setAlertActiveInputSchema, setAlertSubscriptionInputSchema } from './schema';
import * as service from './service';
import * as subs from './subscriptions';

const codeParamSchema = z.object({ code: z.string().min(1) });

// Owner 2026-10-30: "Hide page" on Alerts refuses every Alerts route. Config
// edits keep their own Super Admin rule in the service on top of this.
const alertsPage = (user: AuthContext): Promise<void> =>
  requireFormAccess(user, 'alerts_view', 'view');

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/alerts', async (req) => {
    if (!req.user) throw new AuthenticationError();
    await alertsPage(req.user);
    // ADR-201: search / "show zero" / page on the server; the counts strip is
    // worked out over every active alert.
    const q = listAlertsQuerySchema.parse(req.query);
    return pageAlerts(await service.runAllAlerts(req.user), q);
  });

  app.get('/alerts/config', async (req) => {
    if (!req.user) throw new AuthenticationError();
    await alertsPage(req.user);
    return service.listAlertConfig(req.user);
  });

  app.put('/alerts/config/:code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    await alertsPage(req.user);
    const { code } = codeParamSchema.parse(req.params);
    const input = setAlertActiveInputSchema.parse(req.body);
    return service.setAlertActive(code, input.active, req.user);
  });

  app.get('/alerts/subscriptions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    await alertsPage(req.user);
    return subs.listMySubscriptions(req.user);
  });

  app.put('/alerts/subscriptions/:code', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    await alertsPage(req.user);
    const { code } = codeParamSchema.parse(req.params);
    const input = setAlertSubscriptionInputSchema.parse(req.body);
    const result = await subs.setMySubscription(
      input.channel
        ? { code, subscribed: input.subscribed, channel: input.channel }
        : { code, subscribed: input.subscribed },
      req.user,
    );
    if (result === null) {
      reply.code(204);
      return null;
    }
    return result;
  });

  app.get('/alerts/:code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    await alertsPage(req.user);
    const { code } = codeParamSchema.parse(req.params);
    const q = runAlertQuerySchema.parse(req.query);
    return pageAlertRecords(await service.runAlert(code, req.user), q);
  });
}
