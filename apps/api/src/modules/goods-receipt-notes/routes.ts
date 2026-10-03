import type { FastifyInstance } from 'fastify';
import { activityReasonSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createGoodsReceiptNoteInputSchema,
  listGoodsReceiptNotesQuerySchema,
  updateGoodsReceiptNoteInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });
// ADR-197 — a delete says why (REASON_REQUIRED_ACTIONS). Module-local, so the
// shared contract is untouched; the web sends it as the DELETE body.
const deleteGrnBodySchema = z.object({ reason: activityReasonSchema });

export async function goodsReceiptNotesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/goods-receipt-notes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listGoodsReceiptNotesQuerySchema.parse(req.query);
    return service.listGoodsReceiptNotes(query, req.user);
  });

  app.get('/goods-receipt-notes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getGoodsReceiptNote(id, req.user);
  });

  app.get('/goods-receipt-notes/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getGrnRelated(id, req.user);
  });

  app.post('/goods-receipt-notes', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createGoodsReceiptNoteInputSchema.parse(req.body);
    const detail = await service.createGoodsReceiptNote(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/goods-receipt-notes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateGoodsReceiptNoteInputSchema.parse(req.body);
    return service.updateGoodsReceiptNoteOrStage(id, body, req.user);
  });

  app.delete('/goods-receipt-notes/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = deleteGrnBodySchema.parse(req.body ?? {});
    await service.softDeleteGoodsReceiptNote(id, req.user, reason);
    reply.code(204);
    return null;
  });
}
