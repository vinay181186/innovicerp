import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createOperatorInputSchema,
  listOperatorsQuerySchema,
  updateOperatorInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function operatorsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/operators', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOperatorsQuerySchema.parse(req.query);
    return service.listOperators(query, req.user);
  });

  // Must precede '/operators/:id' so 'next-code' isn't captured as an :id param.
  app.get('/operators/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextOperatorCode(req.user);
  });

  app.get('/operators/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getOperator(id, req.user);
  });

  app.post('/operators', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createOperatorInputSchema.parse(req.body);
    const row = await service.createOperator(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/operators/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateOperatorInputSchema.parse(req.body);
    return service.updateOperator(id, body, req.user);
  });

  app.delete('/operators/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteOperator(id, req.user);
    reply.code(204);
    return null;
  });
}
