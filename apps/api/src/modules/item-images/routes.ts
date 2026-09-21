import { itemImageUrlQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function itemImagesRoutes(app: FastifyInstance): Promise<void> {
  // The ONE route that hands out a link to an item's product image. GET —
  // it returns a link and changes nothing (no activity-log row either: this
  // is a product picture, not a controlled drawing — see service.ts).
  app.get('/item-images/url', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = itemImageUrlQuerySchema.parse(req.query);
    return service.getItemImageUrl(query, req.user);
  });
}
