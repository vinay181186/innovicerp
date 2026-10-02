import {
  listQcLogsQuerySchema,
  listQcPendingQuerySchema,
  qcRegisterQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { listQcRegister } from './register';
import * as service from './service';

export async function qcHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/qc-history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getQcHistory(req.user);
  });

  // Paged lists + whole-set KPIs (ADR-201).
  app.get('/qc-history/pending', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listQcPending(listQcPendingQuerySchema.parse(req.query), req.user);
  });
  app.get('/qc-history/logs', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listQcLogs(listQcLogsQuerySchema.parse(req.query), req.user);
  });
  app.get('/qc-history/stats', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getQcHistoryStats(req.user);
  });

  // QC Call Register — incoming + process calls paged together (ADR-201).
  app.get('/qc-history/register', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listQcRegister(qcRegisterQuerySchema.parse(req.query), req.user);
  });
}
