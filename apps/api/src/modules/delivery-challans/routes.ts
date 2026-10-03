import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  cancelDeliveryChallanInputSchema,
  createDeliveryChallanInputSchema,
  createDeliveryChallanReceiptInputSchema,
  listDeliveryChallansQuerySchema,
  updateDeliveryChallanInputSchema,
} from './schema';
import { listRtvCandidatesQuerySchema } from '@innovic/shared';
import { listRtvCandidates } from './rtv-candidates';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });
const poIdParamSchema = z.object({ poId: z.string().uuid() });

export async function deliveryChallansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/delivery-challans', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDeliveryChallansQuerySchema.parse(req.query);
    return service.listDeliveryChallans(query, req.user);
  });

  // ADR-208 — return-to-vendor NCs by JW PO / DC No. (+New DC → Against JW PO
  // / DC). Static path, registered before '/:id' (find-my-way prefers static
  // segments anyway, so '/:id' never swallows it).
  app.get('/delivery-challans/rtv-candidates', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listRtvCandidatesQuerySchema.parse(req.query);
    return listRtvCandidates(query, req.user);
  });

  app.get('/delivery-challans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getDeliveryChallan(id, req.user);
  });

  app.get('/delivery-challans/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getDeliveryChallanRelated(id, req.user);
  });

  // How many pieces each line of a PO may actually send RIGHT NOW. Read-only,
  // and asked by the create form on open so the Send Now box can warn while the
  // number is being typed instead of failing at Save.
  app.get('/delivery-challans/sendable/:poId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { poId } = poIdParamSchema.parse(req.params);
    return service.getSendableForPo(poId, req.user);
  });

  app.post('/delivery-challans', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createDeliveryChallanInputSchema.parse(req.body);
    const detail = await service.createDeliveryChallan(input, req.user);
    reply.code(201);
    return detail;
  });

  // ADR-202 Phase 3 — edit an issued OSP DC's line qty / material / remarks and
  // header travel details. When the Document Edit Approval gate is on and the DC
  // is live (issued, no receipts, not an NC return-to-vendor challan), the edit is
  // staged and a DocumentEditStagedResult is returned; otherwise it applies. Line
  // add / remove is refused (a DC's item set is fixed from the PO selection).
  app.patch('/delivery-challans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = updateDeliveryChallanInputSchema.parse(req.body);
    return service.updateDeliveryChallanOrStage(id, input, req.user);
  });

  app.post('/delivery-challans/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = cancelDeliveryChallanInputSchema.parse(req.body ?? {});
    return service.cancelDeliveryChallan(id, req.user, reason);
  });

  // T-059b — receive-back. Auto-generates receipt code, fires stock IN +
  // jc_op flip + auto-NC on reject + JC→SO cascade in one tx.
  app.post('/delivery-challans/:id/receive', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = createDeliveryChallanReceiptInputSchema.parse(req.body);
    const detail = await service.receiveAgainstDeliveryChallan(id, input, req.user);
    reply.code(201);
    return detail;
  });
}
