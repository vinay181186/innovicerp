import {
  listItemRevisionChangesQuerySchema,
  listItemRevisionsQuerySchema,
  lookupItemRevisionQuerySchema,
  replaceItemRevisionDrawingInputSchema,
  setStockRevInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { getItemRevisionFixList } from './fix-list';
import * as service from './service';
import { setStockRev } from './stock-set-rev';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function itemRevisionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/item-revisions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listItemRevisions(listItemRevisionsQuerySchema.parse(req.query), req.user);
  });

  // Static paths are declared before /:id.
  app.get('/item-revisions/lookup', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.lookupItemRevision(lookupItemRevisionQuerySchema.parse(req.query), req.user);
  });

  app.get('/item-revisions/changes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listItemRevisionChanges(
      listItemRevisionChangesQuerySchema.parse(req.query),
      req.user,
    );
  });

  app.get('/item-revisions/fix-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return getItemRevisionFixList(req.user);
  });

  // Drawing Rev Phase C — Fix List → Set Rev: move blank-Rev (old) stock of a
  // make item to an Item + Rev. Static path, declared before /:id.
  app.post('/item-revisions/stock-set-rev', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return setStockRev(setStockRevInputSchema.parse(req.body), req.user);
  });

  app.get('/item-revisions/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getItemRevision(id, req.user);
  });

  app.post('/item-revisions/:id/replace-drawing', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = replaceItemRevisionDrawingInputSchema.parse(req.body);
    return service.replaceDrawing(id, input, req.user);
  });
}
