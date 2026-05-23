import { createQcDocumentInputSchema, listQcDocumentsQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function qcDocumentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/qc-documents', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listQcDocumentsQuerySchema.parse(req.query);
    return service.listQcDocuments(query, req.user);
  });

  app.post('/qc-documents', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = createQcDocumentInputSchema.parse(req.body);
    return service.createQcDocument(input, req.user);
  });

  app.delete('/qc-documents/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = req.params as { id: string };
    return service.deleteQcDocument(id, req.user);
  });
}
