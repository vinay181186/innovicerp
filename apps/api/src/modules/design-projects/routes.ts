import {
  addDesignCommentInputSchema,
  createDesignDcnInputSchema,
  createDesignDcrInputSchema,
  createDesignIssueInputSchema,
  createDesignProjectInputSchema,
  createDesignTaskInputSchema,
  listDesignProjectsQuerySchema,
  toggleDesignChecklistItemInputSchema,
  updateDesignDcnInputSchema,
  updateDesignDcrInputSchema,
  updateDesignIssueInputSchema,
  updateDesignProjectInputSchema,
  updateDesignTaskInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });
const projectIdParam = z.object({ projectId: z.string().uuid() });

export async function designProjectsRoutes(app: FastifyInstance): Promise<void> {
  // Projects
  app.get('/design-projects', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDesignProjectsQuerySchema.parse(req.query);
    return service.listDesignProjects(query, req.user);
  });

  app.get('/design-projects/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextDesignProjectCode(req.user);
  });

  app.get('/design-projects/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getDesignProjectDetail(id, req.user);
  });

  app.get('/design-projects/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getDesignProjectRelated(id, req.user);
  });

  app.post('/design-projects', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createDesignProjectInputSchema.parse(req.body);
    const result = await service.createDesignProject(input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/design-projects/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updateDesignProjectInputSchema.parse(req.body);
    return service.updateDesignProject(id, input, req.user);
  });

  app.post('/design-projects/:id/checklist', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = toggleDesignChecklistItemInputSchema.parse(req.body);
    return service.toggleDesignChecklistItem(id, input, req.user);
  });

  app.post('/design-projects/:id/release', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.releaseDesignProject(id, req.user);
  });

  // Tasks
  app.post('/design-projects/:projectId/tasks', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { projectId } = projectIdParam.parse(req.params);
    const input = createDesignTaskInputSchema.parse(req.body);
    const result = await service.createDesignTask(projectId, input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/design-tasks/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updateDesignTaskInputSchema.parse(req.body);
    return service.updateDesignTask(id, input, req.user);
  });

  app.post('/design-tasks/:id/comments', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = addDesignCommentInputSchema.parse(req.body);
    const result = await service.addDesignTaskComment(id, input, req.user);
    reply.code(201);
    return result;
  });

  // Issues
  app.post('/design-projects/:projectId/issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { projectId } = projectIdParam.parse(req.params);
    const input = createDesignIssueInputSchema.parse(req.body);
    const result = await service.createDesignIssue(projectId, input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/design-issues/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updateDesignIssueInputSchema.parse(req.body);
    return service.updateDesignIssue(id, input, req.user);
  });

  app.post('/design-issues/:id/comments', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = addDesignCommentInputSchema.parse(req.body);
    const result = await service.addDesignIssueComment(id, input, req.user);
    reply.code(201);
    return result;
  });

  // DCR / DCN
  app.post('/design-projects/:projectId/dcrs', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { projectId } = projectIdParam.parse(req.params);
    const input = createDesignDcrInputSchema.parse(req.body);
    const result = await service.createDesignDcr(projectId, input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/design-dcrs/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updateDesignDcrInputSchema.parse(req.body);
    return service.updateDesignDcr(id, input, req.user);
  });

  app.post('/design-projects/:projectId/dcns', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { projectId } = projectIdParam.parse(req.params);
    const input = createDesignDcnInputSchema.parse(req.body);
    const result = await service.createDesignDcn(projectId, input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/design-dcns/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updateDesignDcnInputSchema.parse(req.body);
    return service.updateDesignDcn(id, input, req.user);
  });
}
