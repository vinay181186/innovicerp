import type { FastifyInstance } from 'fastify';
import { requireFormAccess } from '../../lib/access';
import { AuthenticationError } from '../../lib/errors';
import { getActivityHistory } from './history';
import { activityHistoryQuerySchema, listActivityLogQuerySchema } from './schema';
import * as service from './service';

export async function activityLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/activity-log', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // Owner 2026-10-30: "Hide page" on Activity Log refuses the page's list.
    await requireFormAccess(req.user, 'activitylog_view', 'view');
    const query = listActivityLogQuerySchema.parse(req.query);
    return service.listActivityLog(query, req.user);
  });

  // ADR-197 — one document's History tab. ?entity=&entityId=&refId=
  // Not gated by Activity Log's Hide page: it follows the document's rights.
  app.get('/activity-log/history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = activityHistoryQuerySchema.parse(req.query);
    return getActivityHistory(query, req.user);
  });
}
