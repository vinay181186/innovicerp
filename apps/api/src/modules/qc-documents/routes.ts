import {
  createQcDocumentInputSchema,
  listQcDocumentsQuerySchema,
  qcDossierOrdersQuerySchema,
  qcDossierQuerySchema,
  qcDossierUrlsInputSchema,
  qcMatrixQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as dossier from './dossier';
import * as matrix from './matrix';
import * as service from './service';

export async function qcDocumentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/qc-documents', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listQcDocumentsQuerySchema.parse(req.query);
    return service.listQcDocuments(query, req.user);
  });

  // SO-pivoted QC-completion matrix (legacy renderQCDocuments L23039).
  app.get('/qc-documents/so-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return matrix.listQcMatrixSos(req.user);
  });

  app.get('/qc-documents/matrix', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = qcMatrixQuerySchema.parse(req.query);
    return matrix.getQcMatrix(query.salesOrderId, req.user);
  });

  // ADR-252 — QC Dossier: SO / JWSO -> POL -> report folders -> files.
  app.get('/qc-documents/dossier/orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = qcDossierOrdersQuerySchema.parse(req.query);
    return dossier.listQcDossierOrders(query, req.user);
  });

  app.get('/qc-documents/dossier', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = qcDossierQuerySchema.parse(req.query);
    return dossier.getQcDossier(query, req.user);
  });

  app.post('/qc-documents/dossier/urls', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = qcDossierUrlsInputSchema.parse(req.body);
    return dossier.getQcDossierUrls(input, req.user);
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
