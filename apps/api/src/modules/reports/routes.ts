import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const slugParamSchema = z.object({ slug: z.string().min(1).max(64) });

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reports', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listReports();
  });

  app.get('/reports/:slug', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { slug } = slugParamSchema.parse(req.params);
    // Strip non-string values + coerce filter values to strings. The query
    // arrives as a `Record<string, unknown>` from Fastify; we want a clean
    // `Record<string, string>` for the registry.
    const rawQuery = (req.query as Record<string, unknown>) ?? {};
    const filters: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawQuery)) {
      if (typeof v === 'string' && v.length > 0) filters[k] = v;
    }
    return service.runReport(slug, filters, req.user);
  });
}
