// One route for every "Excel Template" button. The spec registry lives in
// service.ts; this file only validates the name and sends the workbook.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { XLSX_CONTENT_TYPE } from '../../lib/excel';
import * as service from './service';

const nameParamSchema = z.object({
  // Registry keys only — kebab-case, so the param can never reach the
  // filesystem or a header as anything else.
  name: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
});

export async function importTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/import-templates/:name.xlsx', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { name } = nameParamSchema.parse(req.params);
    const buf = await service.buildImportTemplate(name, req.user);
    reply
      .type(XLSX_CONTENT_TYPE)
      .header(
        'content-disposition',
        `attachment; filename="${service.importTemplateFileName(name)}"`,
      );
    return reply.send(buf);
  });
}
