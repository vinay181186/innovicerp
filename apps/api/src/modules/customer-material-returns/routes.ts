import {
  cancelCustomerMaterialReturnInputSchema,
  createCustomerMaterialReturnInputSchema,
  listCustomerMaterialReturnsQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { requestCancel } from '../cancel-requests/service';
import { listCustomerMaterialReturnLines } from './list-lines';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });
// ADR-307: exactly one of the two (the service refuses none / both with 400).
const returnableQuery = z.object({
  jobWorkOrderId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
});

// ADR-203 (owner D3) — Customer Material Return, IN-CMR-#####.
export async function customerMaterialReturnsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customer-material-returns', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listCustomerMaterialReturnsQuerySchema.parse(req.query);
    return service.listCustomerMaterialReturns(query, req.user);
  });

  // ADR-261 — the register as one row per return line. Before /:id.
  app.get('/customer-material-returns/lines', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listCustomerMaterialReturnsQuerySchema.parse(req.query);
    return listCustomerMaterialReturnLines(query, req.user);
  });

  // Registered before /:id so "returnable" is never read as an id.
  app.get('/customer-material-returns/returnable', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const order = returnableQuery.parse(req.query);
    return service.listCustomerMaterialReturnable(order, req.user);
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

  // ADR-235: no direct cancel any more — this sends a Cancel Request (the
  // Approve-tick holder approves it) and returns the CancelRequestResult.
  app.post('/customer-material-returns/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelCustomerMaterialReturnInputSchema.parse(req.body);
    return requestCancel('customer_material_return', id, { reason, approveNow: false }, req.user);
  });
}
