import {
  changeJcOpMachineInputSchema,
  listJcOpsBoardQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function jcOpsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jc-ops', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJcOpsBoardQuerySchema.parse(req.query);
    return service.listJcOpsBoard(query, req.user);
  });

  app.patch('/jc-ops/:id/machine', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = changeJcOpMachineInputSchema.parse(req.body);
    return service.changeJcOpMachine(id, input, req.user);
  });
}
