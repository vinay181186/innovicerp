import { stockValuationQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function stockValuationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stock-valuation', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // ADR-201: filters, search, Sort & Filter and the page run on the server.
    return service.getStockValuation(req.user, stockValuationQuerySchema.parse(req.query));
  });
}
