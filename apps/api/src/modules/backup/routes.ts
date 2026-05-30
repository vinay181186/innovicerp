import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/backup/stats', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getBackupStats(req.user);
  });

  app.get('/backup/download', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const payload = await service.downloadBackup(req.user);
    const filename = `InnovicERP_Backup_${payload.exportedAt.slice(0, 10).replace(/-/g, '')}.json`;
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return payload;
  });
}
