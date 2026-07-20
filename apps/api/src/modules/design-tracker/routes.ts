import {
  createDesignTrackerInputSchema,
  listDesignTrackerQuerySchema,
  logDesignTimeInputSchema,
  reviseDesignInputSchema,
  updateDesignTrackerInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function designTrackerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/design-tracker', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDesignTrackerQuerySchema.parse(req.query);
    return service.listDesignTracker(query, req.user);
  });

  // Must precede '/design-tracker/:id' so 'next-code' isn't captured as an :id param.
  app.get('/design-tracker/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextDesignTrackerCode(req.user);
  });

  app.get('/design-tracker/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getDesignTrackerDetail(id, req.user);
  });

  app.post('/design-tracker', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createDesignTrackerInputSchema.parse(req.body);
    const result = await service.createDesignTracker(input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/design-tracker/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updateDesignTrackerInputSchema.parse(req.body);
    return service.updateDesignTracker(id, input, req.user);
  });

  app.post('/design-tracker/:id/time', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = logDesignTimeInputSchema.parse(req.body);
    const result = await service.logDesignTime(id, input, req.user);
    reply.code(201);
    return result;
  });

  app.post('/design-tracker/:id/submit-review', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.submitDesignForReview(id, req.user);
  });

  app.post('/design-tracker/:id/approve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.approveDesign(id, req.user);
  });

  app.post('/design-tracker/:id/revise', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = reviseDesignInputSchema.parse(req.body);
    return service.reviseDesign(id, input, req.user);
  });
}
