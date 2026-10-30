// Day Log routes. Idempotency is global (ADR-172 plugin); the day header
// row lock backs a double submit (§20).

import type { FastifyInstance } from 'fastify';
import {
  addDayLogEntriesInputSchema,
  addDayLogTeamMateInputSchema,
  addDayLogEntryInputSchema,
  dayLogOrderOptionsQuerySchema,
  dayLogQuerySchema,
  dayLogApproveInputSchema,
  dayLogPersonDayQuerySchema,
  dayLogRejectInputSchema,
  dayLogTeamMatesQuerySchema,
  editDayLogReplyInputSchema,
  holidayInputSchema,
  sendDayLogReplyInputSchema,
  teamDayLogQuerySchema,
  updateDayLogEntryInputSchema,
  updateDayLogWorkInputSchema,
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

  // ADR-255 — Team Day Logs › a person, one day (revisions for a Super Admin).
  app.get('/day-logs/person-day', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPersonDay(dayLogPersonDayQuerySchema.parse(req.query), req.user);
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

  // ADR-255 — Working On is edited directly by the owner (no approval).
  app.patch('/day-logs/entries/:id/work', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.updateWork(id, updateDayLogWorkInputSchema.parse(req.body), req.user);
  });

  // ADR-255 — Super Admin replies; the owner marks an entry's replies seen.
  app.post('/day-logs/entries/:id/replies', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const result = await service.sendReply(
      id,
      sendDayLogReplyInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });

  app.patch('/day-logs/replies/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.editReply(id, editDayLogReplyInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/entries/:id/replies/seen', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.markRepliesSeen(id, req.user);
  });

  // A saved row is never removed: no DELETE, no Stop (owner 2026-10-27).
  // An edit (PATCH above) waits for approval:
  app.get('/day-logs/approvals', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getApprovals(req.user);
  });

  app.post('/day-logs/entries/:id/approve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.approveEntry(id, dayLogApproveInputSchema.parse(req.body), req.user);
  });

  app.post('/day-logs/entries/:id/reject', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.rejectEntry(id, dayLogRejectInputSchema.parse(req.body), req.user);
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

  // Teams Config (owner 2026-10-30) — Super Admin pairs two people, two-way.
  app.get('/day-logs/team-mates/people', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listTeamPeople(req.user);
  });
  app.get('/day-logs/team-mates', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listTeamMates(dayLogTeamMatesQuerySchema.parse(req.query), req.user);
  });

  app.post('/day-logs/team-mates', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.addTeamMate(
      addDayLogTeamMateInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });

  app.delete('/day-logs/team-mates/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.removeTeamMate(id, req.user);
  });
}
