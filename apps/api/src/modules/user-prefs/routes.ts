// Per-user table preferences (ADR-199). Thin routes: validate, call service.
// The user is always req.user — never read from the body or the URL.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { saveTableLayoutInputSchema, saveUiSettingsInputSchema, tableKeySchema } from './schema';
import * as service from './service';

const tableKeyParamSchema = z.object({ tableKey: tableKeySchema });

export async function userPrefsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/ui-settings', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getUiSettings(req.user);
  });

  app.put('/me/ui-settings', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = saveUiSettingsInputSchema.parse(req.body);
    return service.saveUiSettings(body, req.user);
  });

  app.get('/me/table-layouts/:tableKey', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { tableKey } = tableKeyParamSchema.parse(req.params);
    return service.getTableLayout(tableKey, req.user);
  });

  app.put('/me/table-layouts/:tableKey', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { tableKey } = tableKeyParamSchema.parse(req.params);
    const body = saveTableLayoutInputSchema.parse(req.body);
    return service.saveTableLayout(tableKey, body, req.user);
  });

  app.delete('/me/table-layouts/:tableKey', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { tableKey } = tableKeyParamSchema.parse(req.params);
    return service.resetTableLayout(tableKey, req.user);
  });
}
