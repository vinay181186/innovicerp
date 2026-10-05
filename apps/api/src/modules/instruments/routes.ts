// Instrument register routes (ADR-193 phase 4a).
import {
  createInstrumentInputSchema,
  listInstrumentsQuerySchema,
  markMissingInstrumentInputSchema,
  recordCalibrationInputSchema,
  scrapInstrumentInputSchema,
  sendForCalibrationInputSchema,
  updateInstrumentInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function instrumentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/instruments', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listInstruments(listInstrumentsQuerySchema.parse(req.query), req.user);
  });

  app.get('/instruments/unregistered', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listUnregistered(req.user);
  });

  app.get('/instruments/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getInstrument(idParam.parse(req.params).id, req.user);
  });

  app.post('/instruments', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.createInstrument(
      createInstrumentInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });

  app.patch('/instruments/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.updateInstrumentOrStage(
      idParam.parse(req.params).id,
      updateInstrumentInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/instruments/:id/calibration-out', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.sendForCalibration(
      idParam.parse(req.params).id,
      sendForCalibrationInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/instruments/:id/calibrate', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.recordCalibration(
      idParam.parse(req.params).id,
      recordCalibrationInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/instruments/:id/mark-missing', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.markMissing(
      idParam.parse(req.params).id,
      markMissingInstrumentInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });

  app.post('/instruments/:id/scrap', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.requestScrap(
      idParam.parse(req.params).id,
      scrapInstrumentInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });
}
