// ADR-293 — AI Chat. L6 Super Admin only; read-only answers about ERP data.
import { aiChatRequestSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { requireAdminRole } from '../../lib/auth';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

/** 3 files × 5 MB, base64 (4/3) plus the question — this route only. */
const AI_CHAT_BODY_LIMIT = 22 * 1024 * 1024;

export async function aiChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ai-chat', { bodyLimit: AI_CHAT_BODY_LIMIT }, async (req) => {
    if (!req.user) throw new AuthenticationError();
    requireAdminRole(req.user);
    const input = aiChatRequestSchema.parse(req.body);
    return service.askAiChat(input, req.user);
  });

  app.get('/ai-chat/usage', async (req) => {
    if (!req.user) throw new AuthenticationError();
    requireAdminRole(req.user);
    return service.getAiChatUsage(req.user);
  });
}
