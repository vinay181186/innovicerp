import {
  cancelPartyGrnInputSchema,
  createPartyGrnInputSchema,
  listPartyGrnQuerySchema,
  partyGrnQcInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { qcPartyGrn } from './qc';
import { updatePartyGrnInputSchema } from './schema';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function partyGrnRoutes(app: FastifyInstance): Promise<void> {
  app.get('/party-grn', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPartyGrnQuerySchema.parse(req.query);
    return service.listPartyGrn(query, req.user);
  });

  app.get('/party-grn/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextPartyGrnCode(req.user);
  });

  app.get('/party-grn/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getPartyGrnDetail(id, req.user);
  });

  app.post('/party-grn', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPartyGrnInputSchema.parse(req.body);
    const result = await service.createPartyGrn(input, req.user);
    reply.code(201);
    return result;
  });

  // ADR-202 Phase 3 — edit a Party GRN. When the Document Edit Approval gate is
  // on and the GRN is LIVE (a line still waiting for Incoming QC), the edit is
  // staged and a DocumentEditStagedResult is returned; otherwise it applies.
  app.patch('/party-grn/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updatePartyGrnInputSchema.parse(req.body);
    return service.updatePartyGrnOrStage(id, input, req.user);
  });

  // ADR-203 (D4) — Incoming QC: book accepted / rejected per waiting line.
  app.post('/party-grn/:id/qc', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = partyGrnQcInputSchema.parse(req.body);
    return qcPartyGrn(id, input, req.user);
  });

  // ADR-102 — reverse a wrong receipt (soft-delete + credit party stock back).
  app.post('/party-grn/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelPartyGrnInputSchema.parse(req.body);
    return service.cancelPartyGrn(id, reason, req.user);
  });
}
