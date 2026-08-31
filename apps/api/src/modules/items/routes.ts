import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  bulkCreateItemsInputSchema,
  createItemInputSchema,
  listItemsQuerySchema,
  updateItemInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function itemsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/items', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listItemsQuerySchema.parse(req.query);
    return service.listItems(query, req.user);
  });

  // Must precede '/items/:id' so 'next-code' isn't captured as an :id param.
  app.get('/items/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextItemCode(req.user);
  });

  app.get('/items/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getItem(id, req.user);
  });

  app.post('/items', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createItemInputSchema.parse(req.body);
    const row = await service.createItem(body, req.user);
    reply.code(201);
    return row;
  });

  // Whole-sheet Excel import. Sits beside the single create on purpose: same
  // gate, same shape per row — only the number of round trips differs.
  app.post('/items/bulk', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = bulkCreateItemsInputSchema.parse(req.body);
    const result = await service.createItemsBulk(body, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/items/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateItemInputSchema.parse(req.body);
    return service.updateItem(id, body, req.user);
  });

  app.delete('/items/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteItem(id, req.user);
    reply.code(204);
    return null;
  });
}
