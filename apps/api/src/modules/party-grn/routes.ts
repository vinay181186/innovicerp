import {
  createPartyGrnInputSchema,
  listPartyGrnQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function partyGrnRoutes(app: FastifyInstance): Promise<void> {
  app.get('/party-grn', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPartyGrnQuerySchema.parse(req.query);
    return service.listPartyGrn(query, req.user);
  });

  app.get('/party-grn/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextPartyGrnCode(req.user);
  });

  app.get('/party-grn/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getPartyGrnDetail(id, req.user);
  });

  app.post('/party-grn', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPartyGrnInputSchema.parse(req.body);
    const result = await service.createPartyGrn(input, req.user);
    reply.code(201);
    return result;
  });
}
