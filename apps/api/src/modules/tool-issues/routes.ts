// Tool Issue register routes (ADR-193 phase 4b).
import {
  cancelToolIssueInputSchema,
  createToolIssueInputSchema,
  decideToolWriteoffInputSchema,
  listToolIssuesQuerySchema,
  listToolWriteoffsQuerySchema,
  recordToolReturnInputSchema,
  returnInstrumentsInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function toolIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tool-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listToolIssues(listToolIssuesQuerySchema.parse(req.query), req.user);
  });

  app.get('/tool-issues/holders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listToolHolders(req.user);
  });

  app.get('/tool-issues/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getToolIssue(idParamSchema.parse(req.params).id, req.user);
  });

  app.post('/tool-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.createToolIssue(
      createToolIssueInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });

  app.post('/tool-issues/:id/return', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.recordToolReturn(
      idParamSchema.parse(req.params).id,
      recordToolReturnInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/tool-issues/:id/return-instruments', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.returnInstruments(
      idParamSchema.parse(req.params).id,
      returnInstrumentsInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/tool-issues/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.cancelToolIssue(
      idParamSchema.parse(req.params).id,
      cancelToolIssueInputSchema.parse(req.body),
      req.user,
    );
  });

  app.get('/tool-writeoffs', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listToolWriteoffs(listToolWriteoffsQuerySchema.parse(req.query), req.user);
  });

  app.post('/tool-writeoffs/:id/decide', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.decideToolWriteoff(
      idParamSchema.parse(req.params).id,
      decideToolWriteoffInputSchema.parse(req.body),
      req.user,
    );
  });
}
