import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { updateCompanyInputSchema } from './schema';
import * as service from './service';

export async function companiesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/companies/me', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getMyCompany(req.user);
  });

  app.patch('/companies/me', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = updateCompanyInputSchema.parse(req.body);
    return service.updateMyCompany(body, req.user);
  });
}
