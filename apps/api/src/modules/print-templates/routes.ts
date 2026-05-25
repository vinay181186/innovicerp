import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { savePrintTemplateInputSchema } from './schema';
import * as service from './service';

const keyParamSchema = z.object({ key: z.string().min(1).max(64) });

export async function printTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/print-templates', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listPrintTemplates(req.user);
  });

  app.get('/print-templates/:key/revisions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { key } = keyParamSchema.parse(req.params);
    return service.listPrintTemplateRevisions(key, req.user);
  });

  app.put('/print-templates/:key', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { key } = keyParamSchema.parse(req.params);
    const body = savePrintTemplateInputSchema.parse(req.body);
    return service.savePrintTemplate(key, body.content, req.user);
  });

  app.post('/print-templates/:key/restore-default', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { key } = keyParamSchema.parse(req.params);
    return service.restorePrintTemplateDefault(key, req.user);
  });
}
