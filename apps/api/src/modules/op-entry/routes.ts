import { listOpLogTimeChangePageQuerySchema, listRunningOpsPageQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  decideOpLogTimeChangeInputSchema,
  generateOspPrInputSchema,
  listJcOpsQuerySchema,
  listOpLogQuerySchema,
  listOpLogTimeChangeRequestsQuerySchema,
  listOpMachineOutputQuerySchema,
  listRunningOpsQuerySchema,
  startOpInputSchema,
  stopOpInputSchema,
  submitOpLogInputSchema,
  submitQcLogInputSchema,
  updateOpLogTimingInputSchema,
} from './schema';
import { reverseOpLog, reverseOpLogInputSchema } from './reverse-op-log';
import { listRunningOpsPage } from './running-ops-read';
import * as service from './service';
import { listOpLogTimeChangePage } from './time-change-page';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function opEntryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/op-entry/jc-ops', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJcOpsQuerySchema.parse(req.query);
    return service.listJcOpsEnriched(query, req.user);
  });

  app.get('/op-entry/op-log', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOpLogQuerySchema.parse(req.query);
    return service.listOpLog(query, req.user);
  });

  // Machine-wise output per operation (0095) — "qty wise machine used".
  app.get('/op-entry/machine-output', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOpMachineOutputQuerySchema.parse(req.query);
    return service.listOpMachineOutput(query, req.user);
  });

  app.get('/op-entry/running-ops', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listRunningOpsQuerySchema.parse(req.query);
    return service.listRunningOps(query, req.user);
  });

  // The Live Operations board's two paged tables (ADR-201).
  app.get('/op-entry/running-ops/page', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listRunningOpsPage(listRunningOpsPageQuerySchema.parse(req.query), req.user);
  });

  app.post('/op-entry/op-log', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = submitOpLogInputSchema.parse(req.body);
    const row = await service.submitOpLog(body, req.user);
    reply.code(201);
    return row;
  });

  app.post('/op-entry/qc-log', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = submitQcLogInputSchema.parse(req.body);
    const row = await service.submitQcLog(body, req.user);
    reply.code(201);
    return row;
  });

  // Correct an entry's date/time only (ADR-127). PATCH, not PUT: this is the
  // one narrow mutation op_log accepts — qty is refused by a DB trigger.
  // Returns { applied, opLog, request }: when the ADR-130 approval gate is on
  // and the caller cannot approve, applied is false, opLog is UNCHANGED and
  // request holds what is now waiting for a manager.
  app.patch('/op-entry/op-log/:id/timing', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateOpLogTimingInputSchema.parse({ ...(req.body as object), id });
    return service.updateOpLogTiming(body, req.user);
  });

  // Correct a wrong entry (ADR-197, req. 3.2): the original stays, an opposite
  // entry is added. Reason mandatory; edit + approve on Op Entry (service).
  app.post('/op-entry/op-log/:id/reverse', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = reverseOpLogInputSchema.parse(req.body ?? {});
    const row = await reverseOpLog(id, body, req.user);
    reply.code(201);
    return row;
  });

  // The approvals inbox (Settings → Approvals → Log Entry tab) and the ⏳
  // marker on the log history read the same list.
  app.get('/op-entry/time-changes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOpLogTimeChangeRequestsQuerySchema.parse(req.query);
    return service.listOpLogTimeChangeRequests(query, req.user);
  });

  // The approvals screen's 25-row pages (ADR-201): search + Sort & Filter + total.
  app.get('/op-entry/time-changes/page', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOpLogTimeChangePageQuerySchema.parse(req.query);
    return listOpLogTimeChangePage(query, req.user);
  });

  // Approve / reject. Manager+admin only (enforced in the service and by RLS).
  app.post('/op-entry/time-changes/:id/decide', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = decideOpLogTimeChangeInputSchema.parse({ ...(req.body as object), id });
    return service.decideOpLogTimeChange(body, req.user);
  });

  app.post('/op-entry/start', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = startOpInputSchema.parse(req.body);
    const row = await service.startOp(body, req.user);
    reply.code(201);
    return row;
  });

  // THE stop endpoint for the whole app — the Op Entry screen and both tabs of
  // the Live Operations Board. The body is a full production entry: date, time,
  // shift, operator and quantity, exactly as POST /op-entry/op-log takes them.
  // A quantity of 0 is the breakdown case — it writes no op_log row but still
  // ends the session, and the operator has still had to say so.
  app.post('/op-entry/running-ops/:id/stop', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = stopOpInputSchema.parse(req.body);
    return service.stopOp(id, body, req.user);
  });

  // OSP auto-PR generation (ADR-039). Manager/admin only (enforced in service).
  app.post('/op-entry/osp-pr', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = generateOspPrInputSchema.parse(req.body);
    const result = await service.generateOspPr(body, req.user);
    reply.code(201);
    return result;
  });
}
