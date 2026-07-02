import { createJwDocumentInputSchema, jwDocumentListQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function jwsoDocumentsRoutes(app: FastifyInstance): Promise<void> {
  // One JWSO's registered documents.
  app.get('/jwso-documents', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = jwDocumentListQuerySchema.parse(req.query);
    return service.listJwDocuments(query.jobWorkOrderId, req.user);
  });

  // Register an uploaded file (client already pushed bytes to Storage).
  app.post('/jwso-documents', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwDocumentInputSchema.parse(req.body);
    return service.createJwDocument(input, req.user);
  });

  app.delete('/jwso-documents/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = req.params as { id: string };
    return service.deleteJwDocument(id, req.user);
  });
}
