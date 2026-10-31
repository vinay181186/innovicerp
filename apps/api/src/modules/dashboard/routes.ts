import type { FastifyInstance } from 'fastify';
import {
  dashChecksResponseSchema,
  homeQuerySchema,
  homeResponseSchema,
  markAllNotificationsReadInputSchema,
  markNotificationsReadInputSchema,
  markNotificationsSeenInputSchema,
  notificationsQuerySchema,
  notificationsResponseSchema,
  saveDashboardConfigInputSchema,
} from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import * as configService from './config-service';
import * as checksService from './checks/service';
import * as homeService from './home-service';
import * as notificationsService from './notifications-service';
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

  // ADR-262 — the department checks of the new home, checked against the
  // shared contract before they leave.
  app.get('/dashboard/checks', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return dashChecksResponseSchema.parse(await checksService.getChecks(req.user));
  });

  // ADR-262 — the bell: last 30 IST days, per-item read state.
  app.get('/dashboard/notifications', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = notificationsQuerySchema.parse(req.query);
    return notificationsResponseSchema.parse(
      await notificationsService.getNotifications(req.user, query),
    );
  });

  app.post('/dashboard/notifications/read', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = markNotificationsReadInputSchema.parse(req.body);
    return notificationsService.markNotificationsRead(body, req.user);
  });

  app.post('/dashboard/notifications/read-all', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = markAllNotificationsReadInputSchema.parse(req.body);
    return notificationsService.markAllNotificationsRead(body, req.user);
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
