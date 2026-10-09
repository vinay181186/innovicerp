import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  cancelMlPlanInputSchema,
  createMlPlanInputSchema,
  listMlPlansQuerySchema,
  mlPlanEligibleLinesQuerySchema,
  refreshMlPlanInputSchema,
  updateMlPlanInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

// Multi-Level Plan (ADR-225 phase 3). Access: `mlplan_create` (dept
// Planning) — checked in service.ts, as ml-bom does.
export async function mlPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ml-plans', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listMlPlansQuerySchema.parse(req.query);
    return service.listMlPlans(query, req.user);
  });

  app.get('/ml-plans/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextMlPlanCode(req.user);
  });

  app.get('/ml-plans/eligible-lines', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = mlPlanEligibleLinesQuerySchema.parse(req.query);
    return service.listEligibleLines(query, req.user);
  });

  app.get('/ml-plans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getMlPlan(id, req.user);
  });

  app.post('/ml-plans', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createMlPlanInputSchema.parse(req.body);
    const detail = await service.createMlPlan(input, req.user);
    reply.code(201);
    return detail;
  });

  app.put('/ml-plans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = updateMlPlanInputSchema.parse(req.body);
    return service.updateMlPlan(id, input, req.user);
  });

  app.post('/ml-plans/:id/refresh', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = refreshMlPlanInputSchema.parse(req.body ?? {});
    return service.refreshMlPlan(id, input, req.user);
  });

  app.post('/ml-plans/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = cancelMlPlanInputSchema.parse(req.body ?? {});
    return service.cancelMlPlan(id, input, req.user);
  });
}
