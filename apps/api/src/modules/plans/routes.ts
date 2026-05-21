import {
  createPlanInputSchema,
  listPlansQuerySchema,
  updatePlanInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamsSchema = z.object({ id: z.string().uuid() });

export async function plansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plans', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPlansQuerySchema.parse(req.query);
    return service.listPlans(query, req.user);
  });

  app.get('/plans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    return service.getPlan(id, req.user);
  });

  app.post('/plans', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPlanInputSchema.parse(req.body);
    const result = await service.createPlan(input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/plans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    const input = updatePlanInputSchema.parse(req.body);
    return service.updatePlan(id, input, req.user);
  });

  app.post('/plans/:id/finalize', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    return service.finalizePlan(id, req.user);
  });

  app.delete('/plans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    return service.softDeletePlan(id, req.user);
  });

  app.get('/planning-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPlanningDashboard(req.user);
  });
}
