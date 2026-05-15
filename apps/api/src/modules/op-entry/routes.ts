import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  listJcOpsQuerySchema,
  listOpLogQuerySchema,
  listRunningOpsQuerySchema,
  startOpInputSchema,
  submitOpLogInputSchema,
  submitQcLogInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function opEntryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/op-entry/jc-ops', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJcOpsQuerySchema.parse(req.query);
    return service.listJcOpsEnriched(query, req.user);
  });

  app.get('/op-entry/op-log', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOpLogQuerySchema.parse(req.query);
    return service.listOpLog(query, req.user);
  });

  app.get('/op-entry/running-ops', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listRunningOpsQuerySchema.parse(req.query);
    return service.listRunningOps(query, req.user);
  });

  app.post('/op-entry/op-log', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = submitOpLogInputSchema.parse(req.body);
    const row = await service.submitOpLog(body, req.user);
    reply.code(201);
    return row;
  });

  app.post('/op-entry/qc-log', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = submitQcLogInputSchema.parse(req.body);
    const row = await service.submitQcLog(body, req.user);
    reply.code(201);
    return row;
  });

  app.post('/op-entry/start', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = startOpInputSchema.parse(req.body);
    const row = await service.startOp(body, req.user);
    reply.code(201);
    return row;
  });

  app.post('/op-entry/running-ops/:id/stop', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.stopOp(id, req.user);
  });
}
