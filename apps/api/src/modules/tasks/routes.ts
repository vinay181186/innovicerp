// Task Board routes (ADR-176). Static paths are registered BEFORE /tasks/:id
// so "user-options" / "related-options" / "next-code" / "mark-viewed" are
// never parsed as a task id. Every body / query is parsed with the shared
// Zod schemas; who-am-I always comes from req.user, never the body.

import type { FastifyInstance } from 'fastify';
import {
  TASK_TYPES,
  addTaskCommentInputSchema,
  cancelTaskInputSchema,
  completeTaskInputSchema,
  createPersonalTodoInputSchema,
  createTaskInputSchema,
  listTasksQuerySchema,
  reassignTaskInputSchema,
  relatedOptionsQuerySchema,
  taskAttachmentInputSchema,
  updateTaskInputSchema,
  updateTaskStatusInputSchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });
const nextCodeQuerySchema = z.object({ type: z.enum(TASK_TYPES).default('assigned') });

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  // ── Static routes first ──
  app.get('/tasks', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const q = listTasksQuerySchema.parse(req.query);
    return service.listTasks(q, req.user);
  });

  app.get('/tasks/user-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return { options: await service.listUserOptions(req.user) };
  });

  app.get('/tasks/related-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const q = relatedOptionsQuerySchema.parse(req.query);
    return { options: await service.listRelatedOptions(q, req.user) };
  });

  app.get('/tasks/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { type } = nextCodeQuerySchema.parse(req.query);
    return service.getNextTaskCode(req.user, type);
  });

  app.post('/tasks/mark-viewed', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.markTasksViewed(req.user);
  });

  app.post('/tasks', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createTaskInputSchema.parse(req.body);
    const result = await service.createTask(body, req.user);
    reply.code(201);
    return result;
  });

  app.post('/tasks/personal', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPersonalTodoInputSchema.parse(req.body);
    const result = await service.createPersonalTodo(body, req.user);
    reply.code(201);
    return result;
  });

  // ── Per-task routes ──
  app.get('/tasks/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getTask(id, req.user);
  });

  app.patch('/tasks/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateTaskInputSchema.parse(req.body);
    return service.updateTask(id, body, req.user);
  });

  app.post('/tasks/:id/status', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateTaskStatusInputSchema.parse(req.body);
    return service.updateTaskStatus(id, body, req.user);
  });

  app.post('/tasks/:id/complete', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = completeTaskInputSchema.parse(req.body ?? {});
    return service.completeTask(id, body, req.user);
  });

  app.post('/tasks/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = cancelTaskInputSchema.parse(req.body ?? {});
    return service.cancelTask(id, body, req.user);
  });

  app.post('/tasks/:id/reassign', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = reassignTaskInputSchema.parse(req.body);
    return service.reassignTask(id, body, req.user);
  });

  app.post('/tasks/:id/comments', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = addTaskCommentInputSchema.parse(req.body);
    const result = await service.addTaskComment(id, body, req.user);
    reply.code(201);
    return result;
  });

  app.post('/tasks/:id/attachments', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = taskAttachmentInputSchema.parse(req.body);
    const result = await service.addTaskAttachment(id, body, req.user);
    reply.code(201);
    return result;
  });

  app.get('/tasks/:id/history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return { history: await service.getTaskHistory(id, req.user) };
  });
}
