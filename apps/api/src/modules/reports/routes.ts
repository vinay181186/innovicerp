import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildWorkbookBuffer, XLSX_CONTENT_TYPE, xlsxFilename } from '../../lib/excel';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const slugParamSchema = z.object({ slug: z.string().min(1).max(64) });

function coerceFilters(rawQuery: unknown): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries((rawQuery as Record<string, unknown>) ?? {})) {
    if (typeof v === 'string' && v.length > 0) filters[k] = v;
  }
  return filters;
}

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reports', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listReports();
  });

  app.get('/reports/:slug', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { slug } = slugParamSchema.parse(req.params);
    return service.runReport(slug, coerceFilters(req.query), req.user);
  });

  app.get('/reports/:slug/export.xlsx', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { slug } = slugParamSchema.parse(req.params);
    const result = await service.runReport(slug, coerceFilters(req.query), req.user);
    const buf = await buildWorkbookBuffer({
      id: result.slug,
      title: result.title,
      columns: result.columns,
      rows: result.rows,
      filters: result.filters,
      generatedBy: req.user.email,
      generatedAt: result.generatedAt,
    });
    reply
      .type(XLSX_CONTENT_TYPE)
      .header(
        'content-disposition',
        `attachment; filename="${xlsxFilename(result.slug, result.generatedAt)}"`,
      );
    return reply.send(buf);
  });
}
