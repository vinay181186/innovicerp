// ADR-291 — Engineering Change (ECR) routes. Page /ecrs, form key ecr_create.

import {
  createEcrInputSchema,
  decideEcrInputSchema,
  ecrActionInputSchema,
  listEcrQuerySchema,
  setEcrDispositionsInputSchema,
  submitEcrInputSchema,
  updateEcrInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { implementEcr } from './implement';
import { createEcr, getEcr, listEcrs, updateEcr } from './service';
import { cancelEcr, closeEcr, decideEcr, setEcrDispositions, submitEcr } from './workflow';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function engineeringChangeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ecrs', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listEcrs(listEcrQuerySchema.parse(req.query), req.user);
  });

  app.post('/ecrs', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return createEcr(createEcrInputSchema.parse(req.body), req.user);
  });

  app.get('/ecrs/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return getEcr(id, req.user);
  });

  app.patch('/ecrs/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return updateEcr(id, updateEcrInputSchema.parse(req.body), req.user);
  });

  app.post('/ecrs/:id/submit', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return submitEcr(id, submitEcrInputSchema.parse(req.body ?? {}), req.user);
  });

  app.put('/ecrs/:id/dispositions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return setEcrDispositions(id, setEcrDispositionsInputSchema.parse(req.body), req.user);
  });

  app.post('/ecrs/:id/decide', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return decideEcr(id, decideEcrInputSchema.parse(req.body), req.user);
  });

  app.post('/ecrs/:id/implement', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return implementEcr(id, ecrActionInputSchema.parse(req.body ?? {}), req.user);
  });

  app.post('/ecrs/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return cancelEcr(id, ecrActionInputSchema.parse(req.body ?? {}), req.user);
  });

  app.post('/ecrs/:id/close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return closeEcr(id, ecrActionInputSchema.parse(req.body ?? {}), req.user);
  });
}
