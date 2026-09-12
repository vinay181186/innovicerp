import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  closeNcReworkInputSchema,
  createNcDcInputSchema,
  createNcRegisterInputSchema,
  disposeNcInputSchema,
  listNcRegisterQuerySchema,
  updateNcRegisterInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function ncRegisterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/nc-register', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listNcRegisterQuerySchema.parse(req.query);
    return service.listNcRegister(query, req.user);
  });

  // Company-wide stat cards (legacy HTML L22508-22519). Declared before
  // `/:id` so "summary" isn't captured as an id param.
  app.get('/nc-register/summary', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNcRegisterSummary(req.user);
  });

  app.get('/nc-register/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getNcRegister(id, req.user);
  });

  app.get('/nc-register/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getNcRegisterRelated(id, req.user);
  });

  app.post('/nc-register', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createNcRegisterInputSchema.parse(req.body);
    const detail = await service.createNcRegister(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/nc-register/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateNcRegisterInputSchema.parse(req.body);
    return service.updateNcRegister(id, body, req.user);
  });

  app.delete('/nc-register/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteNcRegister(id, req.user);
    reply.code(204);
    return null;
  });

  app.post('/nc-register/:id/dispose', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = disposeNcInputSchema.parse(req.body);
    return service.disposeNcRegister(id, body, req.user);
  });

  app.post('/nc-register/:id/close-rework', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = closeNcReworkInputSchema.parse(req.body);
    return service.closeNcRework(id, body, req.user);
  });

  // Legacy close for a return_to_vendor NC. Since the QC–NC handling change it
  // goes through the same closure gate as /close: the challan must have been
  // issued, every piece received back and Incoming QC recorded on all of them.
  app.post('/nc-register/:id/close-return', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.closeNcReturnToVendor(id, req.user);
  });

  // Manual close (design §3 closure gate). Refuses with the exact shortfall
  // — the same text the detail screen shows next to the Close button.
  app.post('/nc-register/:id/close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.closeNc(id, req.user);
  });

  // Return-to-vendor challan raised from the NC itself (design §5).
  app.post('/nc-register/:id/create-dc', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = createNcDcInputSchema.parse(req.body);
    const result = await service.createNcDc(id, body, req.user);
    reply.code(201);
    return result;
  });
}
