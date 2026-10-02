import {
  activityReasonSchema,
  createPlanInputSchema,
  createPlansBatchInputSchema,
  defaultRouteOpsQuerySchema,
  listPlansQuerySchema,
  releaseReservationInputSchema,
  reserveStockInputSchema,
  unplannedOrdersQuerySchema,
  updatePlanInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamsSchema = z.object({ id: z.string().uuid() });
// ADR-197 — a delete carries its reason (module-local: the shared contract is frozen).
const deletePlanBodySchema = z.object({ reason: activityReasonSchema });

export async function plansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plans', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPlansQuerySchema.parse(req.query);
    return service.listPlans(query, req.user);
  });

  app.get('/plans/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextPlanCode(req.user);
  });

  app.get('/plans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    return service.getPlan(id, req.user);
  });

  app.get('/plans/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    return service.getPlanRelated(id, req.user);
  });

  app.post('/plans', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPlanInputSchema.parse(req.body);
    const result = await service.createPlan(input, req.user);
    reply.code(201);
    return result;
  });

  // BOM Planning "Save N Plans" — all child plans in one transaction.
  app.post('/plans/batch', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPlansBatchInputSchema.parse(req.body);
    const result = await service.createPlansBatch(input, req.user);
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
    const { reason } = deletePlanBodySchema.parse(req.body ?? {});
    return service.softDeletePlan(id, reason, req.user);
  });

  app.post('/plans/:id/execute', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamsSchema.parse(req.params);
    return service.executePlan(id, req.user);
  });

  app.get('/plans/default-ops', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { itemId } = defaultRouteOpsQuerySchema.parse(req.query);
    // Service already answers in the defaultRouteOpsResponseSchema shape
    // ({ ops, routeCardCode, routeCardRevision }) — no wrapping here.
    return service.getDefaultRouteOpsForItem(itemId, req.user);
  });

  app.get('/planning-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPlanningDashboard(req.user);
  });

  // PL-3b — Needs Planning tile drill: returns unplanned SO lines.
  // Mirrors legacy renderPlanDashboard L10024–10041 when flt='unplanned'.
  app.get('/planning-dashboard/unplanned', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // ADR-201 — search / Sort & Filter / paging on the server.
    return service.getUnplannedOrders(req.user, unplannedOrdersQuerySchema.parse(req.query));
  });

  // Stage 1 SO stock reservation — book in-stock qty to an SO line, or release
  // all active reservations on the line back to general stock.
  app.post('/so-reservations', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = reserveStockInputSchema.parse(req.body);
    const result = await service.reserveStock(input, req.user);
    reply.code(201);
    return result;
  });

  app.post('/so-reservations/release', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = releaseReservationInputSchema.parse(req.body);
    return service.releaseReservationsForLine(input, req.user);
  });
}
