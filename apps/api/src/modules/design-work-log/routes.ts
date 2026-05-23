import {
  createDesignWorkLogInputSchema,
  listDesignWorkLogQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function designWorkLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/design-work-log', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDesignWorkLogQuerySchema.parse(req.query);
    return service.listDesignWorkLog(query, req.user);
  });

  app.post('/design-work-log', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createDesignWorkLogInputSchema.parse(req.body);
    const result = await service.createDesignWorkLogEntry(input, req.user);
    reply.code(201);
    return result;
  });

  app.delete('/design-work-log/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    await service.deleteDesignWorkLogEntry(id, req.user);
    reply.code(204);
    return null;
  });
}
