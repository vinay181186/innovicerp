import { listDesignIssuesQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function designIssuesRoutes(app: FastifyInstance): Promise<void> {
  // Cross-project read-only list. Writes are nested under
  // /design-projects/:projectId/issues + /design-issues/:id (PATCH/comments).
  app.get('/design-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDesignIssuesQuerySchema.parse(req.query);
    return service.listDesignIssuesAll(query, req.user);
  });
}
