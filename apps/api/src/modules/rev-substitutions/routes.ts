import { createRevSubstitutionInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { cancelRevSubstitutionInputSchema, listRevSubstitutionsQuerySchema } from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

// ADR-292 — approved Rev substitutions (page /rev-substitutions, ecr_create).
export async function revSubstitutionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rev-substitutions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listRevSubstitutions(listRevSubstitutionsQuerySchema.parse(req.query), req.user);
  });

  app.post('/rev-substitutions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.createRevSubstitution(
      createRevSubstitutionInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/rev-substitutions/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.cancelRevSubstitution(
      id,
      cancelRevSubstitutionInputSchema.parse(req.body ?? {}),
      req.user,
    );
  });
}
