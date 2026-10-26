// Day Log routes. Idempotency is global (ADR-172 plugin); the header row lock
// and the partial-unique indexes back a double submit (§20).

import type { FastifyInstance } from 'fastify';
import {
  dayLogDateInputSchema,
  dayLogQuerySchema,
  dayLogReasonInputSchema,
  dayLogUserDayInputSchema,
  holidayInputSchema,
  saveMyBreaksInputSchema,
  setDayLogEntryStatusInputSchema,
  startDayLogTimerInputSchema,
  stopDayLogTimerInputSchema,
  teamDayLogQuerySchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function dayLogsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/day-logs/access', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getAccess(req.user);
  });

  app.get('/day-logs/day', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getDay(dayLogQuerySchema.parse(req.query), req.user);
  });

  app.get('/day-logs/team', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getTeam(teamDayLogQuerySchema.parse(req.query), req.user);
  });

  app.patch('/day-logs/entries/:id/status', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.setEntryStatus(id, setDayLogEntryStatusInputSchema.parse(req.body), req.user);
  });

  app.delete('/day-logs/entries/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.deleteEntry(id, req.user);
  });

  app.post('/day-logs/timer/start', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.startTimer(startDayLogTimerInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/timer/stop', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.stopTimer(stopDayLogTimerInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/submit', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.submitDay(dayLogDateInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/reopen', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.reopenDay(dayLogReasonInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/leave', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.markLeave(dayLogReasonInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/remind', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.remindUser(dayLogUserDayInputSchema.parse(req.body), req.user);
  });

  app.get('/day-logs/my-breaks', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getMyBreaks(req.user);
  });

  app.put('/day-logs/my-breaks', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.saveMyBreaks(saveMyBreaksInputSchema.parse(req.body), req.user);
  });

  app.get('/day-logs/holidays', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listHolidays(req.user);
  });

  app.post('/day-logs/holidays', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.addHoliday(holidayInputSchema.parse(req.body), req.user);
    reply.code(201);
    return result;
  });

  app.delete('/day-logs/holidays/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.deleteHoliday(id, req.user);
  });
}
