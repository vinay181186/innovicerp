import { checkDocNumberQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function docNumbersRoutes(app: FastifyInstance): Promise<void> {
  // GET /doc-numbers/check?type=<docType>&code=<code?>
  // Returns { exists, nextCode, formatValid } for the document-number override UI.
  app.get('/doc-numbers/check', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = checkDocNumberQuerySchema.parse(req.query);
    return service.checkDocNumber(query, req.user);
  });
}
