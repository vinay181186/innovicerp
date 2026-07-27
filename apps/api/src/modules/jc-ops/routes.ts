import {
  changeJcOpMachineInputSchema,
  listJcOpsBoardQuerySchema,
  outsourceOpBalanceInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { outsourceOpBalance } from './outsource-balance';
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

  // ADR-081 dual-lane — outsource the remaining qty of an in-house process op.
  app.post('/jc-ops/:id/outsource-balance', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = outsourceOpBalanceInputSchema.parse(req.body);
    return outsourceOpBalance(id, input, req.user);
  });
}
