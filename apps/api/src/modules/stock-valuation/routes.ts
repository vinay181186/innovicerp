import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function stockValuationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stock-valuation', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getStockValuation(req.user);
  });
}
