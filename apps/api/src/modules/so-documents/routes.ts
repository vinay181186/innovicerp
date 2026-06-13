import { createSoDocumentInputSchema, soDocumentDetailQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function soDocumentsRoutes(app: FastifyInstance): Promise<void> {
  // All-SOs overview with file counts (legacy SO-Documents landing).
  app.get('/so-documents/overview', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listSoDocumentOverview(req.user);
  });

  // One SO's documents (header + lines + files).
  app.get('/so-documents/detail', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = soDocumentDetailQuerySchema.parse(req.query);
    return service.getSoDocumentDetail(query.salesOrderId, req.user);
  });

  // Register an uploaded file (client already pushed bytes to Storage).
  app.post('/so-documents', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = createSoDocumentInputSchema.parse(req.body);
    return service.createSoDocument(input, req.user);
  });

  app.delete('/so-documents/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = req.params as { id: string };
    return service.deleteSoDocument(id, req.user);
  });
}
