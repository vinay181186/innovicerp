// Day Log routes. Idempotency is global (ADR-172 plugin); the header row lock
// and the partial-unique indexes back a double submit (§20).

import type { FastifyInstance } from 'fastify';
import {
  addDayLogEntriesInputSchema,
  addDayLogEntryInputSchema,
  dayLogDateInputSchema,
  dayLogOrderOptionsQuerySchema,
  dayLogQuerySchema,
  holidayInputSchema,
  personDayLogQuerySchema,
  stopDayLogEntryInputSchema,
  teamDayLogQuerySchema,
  updateDayLogEntryInputSchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { dayLogReasonInputSchema } from './manage';
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

  app.get('/day-logs/person', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPerson(personDayLogQuerySchema.parse(req.query), req.user);
  });

  app.get('/day-logs/order-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.orderOptions(dayLogOrderOptionsQuerySchema.parse(req.query), req.user);
  });

  app.post('/day-logs/entries', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.addEntry(addDayLogEntryInputSchema.parse(req.body), req.user);
  });

  // ONE SHEET: several new rows, all or nothing.
  app.post('/day-logs/entries/batch', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.addEntries(addDayLogEntriesInputSchema.parse(req.body), req.user);
  });

  app.patch('/day-logs/entries/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.updateEntry(id, updateDayLogEntryInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/entries/:id/stop', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    // A break stop may send no body at all.
    const input = stopDayLogEntryInputSchema.parse(req.body ?? {});
    return service.stopEntry(id, input, req.user);
  });

  app.delete('/day-logs/entries/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.deleteEntry(id, req.user);
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
