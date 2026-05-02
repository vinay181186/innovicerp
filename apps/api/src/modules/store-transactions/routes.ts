import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { listStoreTransactionsQuerySchema } from './schema';
import * as service from './service';

const itemIdParamSchema = z.object({ itemId: z.string().uuid() });

export async function storeTransactionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store-transactions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listStoreTransactionsQuerySchema.parse(req.query);
    return service.listStoreTransactions(query, req.user);
  });

  app.get('/store-transactions/item-balance/:itemId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { itemId } = itemIdParamSchema.parse(req.params);
    return service.getItemBalance(itemId, req.user);
  });
}
