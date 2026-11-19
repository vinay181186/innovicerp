import type { FastifyInstance } from 'fastify';
import { listExportLogInputSchema } from '@innovic/shared';
import { requireFormAccess } from '../../lib/access';
import { AuthenticationError } from '../../lib/errors';
import { logListExport } from './export-log';
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

  // ADR-310 — the browser reports an Excel export it just built: ONE EXPORT
  // row. Any logged-in user (owner D2): an export is a read of a list they can
  // already open, so no page gate here.
  app.post('/activity-log/export', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = listExportLogInputSchema.parse(req.body);
    await logListExport(input, req.user);
    reply.code(204);
    return null;
  });
}
