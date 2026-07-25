import { createJwInvoiceInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function jwInvoicesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jw-invoices', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listJwInvoices(req.user);
  });

  app.post('/jw-invoices', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwInvoiceInputSchema.parse(req.body);
    const result = await service.createJwInvoice(input, req.user);
    reply.code(201);
    return result;
  });
}
