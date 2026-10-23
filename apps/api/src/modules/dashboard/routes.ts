import type { FastifyInstance } from 'fastify';
import {
  homeQuerySchema,
  homeResponseSchema,
  markNotificationsSeenInputSchema,
  saveDashboardConfigInputSchema,
} from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import * as configService from './config-service';
import * as homeService from './home-service';
import * as service from './service';
import * as widgetsService from './widgets-service';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/kpis', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getDashboardKpis(req.user);
  });

  // ADR-250 — the per-person home. The payload is checked against the shared
  // contract before it leaves, so the web can never receive a shape it does
  // not know.
  app.get('/dashboard/home', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = homeQuerySchema.parse(req.query);
    return homeResponseSchema.parse(await homeService.getHome(req.user, query));
  });

  // Moves the caller's own notifications "seen" time forward (never back).
  app.post('/dashboard/notifications/seen', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = markNotificationsSeenInputSchema.parse(req.body);
    return homeService.markNotificationsSeen(body, req.user);
  });

  app.get('/dashboard/widgets', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return widgetsService.getWidgets(req.user);
  });

  app.get('/dashboard/config', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return configService.getConfigScreen(req.user);
  });

  app.put('/dashboard/config', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = saveDashboardConfigInputSchema.parse(req.body);
    return configService.saveConfig(body, req.user);
  });
}
