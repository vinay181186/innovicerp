import {
  jobQueueQuerySchema,
  reorderJobQueueInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const machineIdParam = z.object({ machineId: z.string().uuid() });

export async function jobQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-queue', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = jobQueueQuerySchema.parse(req.query);
    return service.getJobQueue(query, req.user);
  });

  app.put('/job-queue/machines/:machineId/order', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { machineId } = machineIdParam.parse(req.params);
    const input = reorderJobQueueInputSchema.parse(req.body);
    return service.reorderMachineQueue(machineId, input, req.user);
  });
}
