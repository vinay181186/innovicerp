import type { FastifyInstance } from 'fastify';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  createTaskInputSchema,
  updateTaskStatusInputSchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({
  assignedTo: z.string().uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
});

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const q = listQuerySchema.parse(req.query);
    return service.listTasks(q, req.user);
  });

  app.get('/tasks/user-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return { options: await service.listUserOptions(req.user) };
  });

  app.post('/tasks/mark-viewed', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.markTasksViewed(req.user);
  });

  app.get('/tasks/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextTaskCode(req.user);
  });

  app.get('/tasks/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getTask(id, req.user);
  });

  app.post('/tasks', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createTaskInputSchema.parse(req.body);
    const result = await service.createTask(body, req.user);
    reply.code(201);
    return result;
  });

  app.post('/tasks/:id/status', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateTaskStatusInputSchema.parse(req.body);
    return service.updateTaskStatus(id, body, req.user);
  });
}
