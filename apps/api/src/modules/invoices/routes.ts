import type { FastifyInstance } from 'fastify';
import { addPaymentInputSchema, createInvoiceInputSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function invoicesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/invoices', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listInvoices(req.user);
  });

  app.get('/invoices/invoiceable/:soId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = z.object({ soId: z.string().uuid() }).parse(req.params);
    return service.getInvoiceableSo(soId, req.user);
  });

  app.get('/invoices/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getInvoice(id, req.user);
  });

  app.post('/invoices', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createInvoiceInputSchema.parse(req.body);
    const result = await service.createInvoice(body, req.user);
    reply.code(201);
    return result;
  });

  app.post('/invoices/:id/payments', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = addPaymentInputSchema.parse(req.body);
    const result = await service.addPayment(id, body, req.user);
    reply.code(201);
    return result;
  });
}
