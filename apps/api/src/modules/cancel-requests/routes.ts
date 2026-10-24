// ADR-235 — the standard Cancel. Preview, request (optionally approve at once),
// decide, withdraw, and the Approvals inbox list. Idempotency is global
// (ADR-172 plugin); the partial-unique index backs a double submit.

import type { FastifyInstance } from 'fastify';
import {
  cancelDocTypeSchema,
  decideCancelInputSchema,
  listCancelRequestsQuerySchema,
  requestCancelInputSchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const docParamSchema = z.object({ docType: cancelDocTypeSchema, docId: z.string().uuid() });
const idParamSchema = z.object({ id: z.string().uuid() });

export async function cancelRequestsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cancel/:docType/:docId/preview', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { docType, docId } = docParamSchema.parse(req.params);
    return service.getCancelPreview(docType, docId, req.user);
  });

  app.post('/cancel/:docType/:docId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { docType, docId } = docParamSchema.parse(req.params);
    return service.requestCancel(
      docType,
      docId,
      requestCancelInputSchema.parse(req.body ?? {}),
      req.user,
    );
  });

  app.post('/cancel-requests/:id/decide', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.decideCancelRequest(id, decideCancelInputSchema.parse(req.body ?? {}), req.user);
  });

  app.post('/cancel-requests/:id/withdraw', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.withdrawCancelRequest(id, req.user);
  });

  app.get('/cancel-requests', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listCancelRequests(listCancelRequestsQuerySchema.parse(req.query), req.user);
  });
}
