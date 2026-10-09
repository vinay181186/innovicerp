// Edit-approval engine routes (ADR-202). The inbox tab and the per-document chip
// read GET /document-edits; the approver decides or the requester withdraws. The
// REQUEST (staging) path is not an HTTP route of its own this phase — it is
// driven from the document's own edit flow via requestDocumentEdit().
//
// Idempotency is global (ADR-172 plugin) — no per-route work here.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  decideDocumentEditInputSchema,
  listDocumentEditsQuerySchema,
  withdrawDocumentEditInputSchema,
} from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import { decideDocumentEdit, withdrawDocumentEdit } from './service';
import { documentEditCounts, listDocumentEdits } from './list';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function documentEditsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/document-edits', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDocumentEditsQuerySchema.parse(req.query);
    return listDocumentEdits(query, req.user);
  });

  app.get('/document-edits/counts', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return documentEditCounts(req.user);
  });

  app.post('/document-edits/:id/decide', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = decideDocumentEditInputSchema.parse({ ...(req.body as object), id });
    return decideDocumentEdit(body, req.user);
  });

  app.post('/document-edits/:id/withdraw', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { id: parsedId } = withdrawDocumentEditInputSchema.parse({ id });
    return withdrawDocumentEdit(parsedId, req.user);
  });
}
