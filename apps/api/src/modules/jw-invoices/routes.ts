import { createJwInvoiceInputSchema, listJwInvoicesQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function jwInvoicesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jw-invoices', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJwInvoicesQuerySchema.parse(req.query);
    return service.listJwInvoices(query, req.user);
  });

  // Line options for the New JW Invoice form: To Invoice per JWSO line.
  app.get('/jw-invoices/invoiceable-lines/:jobWorkOrderId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { jobWorkOrderId } = z.object({ jobWorkOrderId: z.string().uuid() }).parse(req.params);
    return service.listJwInvoiceableLines(jobWorkOrderId, req.user);
  });

  app.post('/jw-invoices', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwInvoiceInputSchema.parse(req.body);
    const result = await service.createJwInvoice(input, req.user);
    reply.code(201);
    return result;
  });
}
