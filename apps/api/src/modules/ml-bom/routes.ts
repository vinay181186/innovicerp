import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createMlBomInputSchema,
  deleteMlBomInputSchema,
  listMlBomsQuerySchema,
  makeDefaultMlBomInputSchema,
  mlBomTreeQuerySchema,
  updateMlBomInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

// Multi-Level BOM (ADR-225). Access: `mlbom_create` (dept design) — checked
// in service.ts, as bom-master does.
export async function mlBomRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ml-boms', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listMlBomsQuerySchema.parse(req.query);
    return service.listMlBoms(query, req.user);
  });

  app.get('/ml-boms/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextMlBomCode(req.user);
  });

  app.get('/ml-boms/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getMlBom(id, req.user);
  });

  app.get('/ml-boms/:id/tree', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const query = mlBomTreeQuerySchema.parse(req.query);
    return service.getMlBomTree(id, query, req.user);
  });

  app.post('/ml-boms', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createMlBomInputSchema.parse(req.body);
    const detail = await service.createMlBom(input, req.user);
    reply.code(201);
    return detail;
  });

  app.put('/ml-boms/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = updateMlBomInputSchema.parse(req.body);
    return service.updateMlBom(id, input, req.user);
  });

  app.post('/ml-boms/:id/make-default', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = makeDefaultMlBomInputSchema.parse(req.body ?? {});
    return service.makeDefaultMlBom(id, input, req.user);
  });

  app.delete('/ml-boms/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = deleteMlBomInputSchema.parse(req.body ?? {});
    return service.softDeleteMlBom(id, req.user, reason);
  });
}
