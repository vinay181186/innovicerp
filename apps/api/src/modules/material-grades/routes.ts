import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  bulkCreateMaterialGradesInputSchema,
  createMaterialGradeInputSchema,
  listMaterialGradesQuerySchema,
  updateMaterialGradeInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function materialGradesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/material-grades', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listMaterialGradesQuerySchema.parse(req.query);
    return service.listMaterialGrades(query, req.user);
  });

  app.get('/material-grades/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getMaterialGrade(id, req.user);
  });

  app.post('/material-grades', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createMaterialGradeInputSchema.parse(req.body);
    const row = await service.createMaterialGrade(body, req.user);
    reply.code(201);
    return row;
  });

  // Whole-sheet import. Declared BEFORE the ':id' routes so 'bulk' is never
  // captured as an :id param. Same gate and same per-row shape as the single
  // create — only the round trips differ.
  app.post('/material-grades/bulk', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = bulkCreateMaterialGradesInputSchema.parse(req.body);
    const result = await service.createMaterialGradesBulk(body, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/material-grades/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateMaterialGradeInputSchema.parse(req.body);
    return service.updateMaterialGrade(id, body, req.user);
  });

  app.delete('/material-grades/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteMaterialGrade(id, req.user);
    reply.code(204);
    return null;
  });
}
