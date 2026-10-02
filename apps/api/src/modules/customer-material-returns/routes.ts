import {
  cancelCustomerMaterialReturnInputSchema,
  createCustomerMaterialReturnInputSchema,
  listCustomerMaterialReturnsQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });
const returnableQuery = z.object({ jobWorkOrderId: z.string().uuid() });

// ADR-203 (owner D3) — Customer Material Return, IN-CMR-#####.
export async function customerMaterialReturnsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customer-material-returns', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listCustomerMaterialReturnsQuerySchema.parse(req.query);
    return service.listCustomerMaterialReturns(query, req.user);
  });

  // Registered before /:id so "returnable" is never read as an id.
  app.get('/customer-material-returns/returnable', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { jobWorkOrderId } = returnableQuery.parse(req.query);
    return service.listCustomerMaterialReturnable(jobWorkOrderId, req.user);
  });

  app.get('/customer-material-returns/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getCustomerMaterialReturnDetail(id, req.user);
  });

  app.post('/customer-material-returns', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createCustomerMaterialReturnInputSchema.parse(req.body);
    const result = await service.createCustomerMaterialReturn(input, req.user);
    reply.code(201);
    return result;
  });

  app.post('/customer-material-returns/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelCustomerMaterialReturnInputSchema.parse(req.body);
    return service.cancelCustomerMaterialReturn(id, reason, req.user);
  });
}
