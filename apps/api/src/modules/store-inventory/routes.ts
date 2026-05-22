import {
  adjustStockInputSchema,
  listStoreInventoryQuerySchema,
  setMinStockInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function storeInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store-inventory', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listStoreInventoryQuerySchema.parse(req.query);
    return service.listStoreInventory(query, req.user);
  });

  app.post('/store-inventory/adjust', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = adjustStockInputSchema.parse(req.body);
    return service.adjustStock(input, req.user);
  });

  app.post('/store-inventory/set-min', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = setMinStockInputSchema.parse(req.body);
    return service.setMinStock(input, req.user);
  });
}
