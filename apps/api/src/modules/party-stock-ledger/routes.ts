import { listPartyStockLedgerQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function partyStockLedgerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/party-stock-ledger', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPartyStockLedgerQuerySchema.parse(req.query);
    return service.listPartyStockLedger(query, req.user);
  });
}
