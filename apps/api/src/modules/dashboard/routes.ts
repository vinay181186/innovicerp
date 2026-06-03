import type { FastifyInstance } from 'fastify';
import { saveDashboardConfigInputSchema } from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import * as configService from './config-service';
import * as homeService from './home-service';
import * as service from './service';
import * as widgetsService from './widgets-service';
import * as workListService from './work-list-service';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/kpis', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getDashboardKpis(req.user);
  });

  app.get('/dashboard/home', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return homeService.getHome(req.user);
  });

  app.get('/dashboard/work-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return { items: await workListService.getWorkList(req.user) };
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
