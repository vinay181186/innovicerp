import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { captureUnhandledError } from '../lib/sentry';

const isFastifyClientError = (e: unknown): e is FastifyError =>
  typeof e === 'object' &&
  e !== null &&
  'statusCode' in e &&
  typeof (e as { statusCode?: unknown }).statusCode === 'number' &&
  (e as { statusCode: number }).statusCode >= 400 &&
  (e as { statusCode: number }).statusCode < 500;

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
      return;
    }

    if (err instanceof ZodError) {
      reply.code(400).send({
        error: 'validation_error',
        message: 'Request validation failed',
        details: err.flatten(),
      });
      return;
    }

    if (isFastifyClientError(err)) {
      reply.code(err.statusCode ?? 400).send({
        error: err.code ?? 'request_error',
        message: err.message,
      });
      return;
    }

    req.log.error({ err }, 'unhandled error');
    captureUnhandledError(err, {
      user: req.user,
      requestId: req.id,
      method: req.method,
      url: req.url,
    });
    reply.code(500).send({ error: 'internal_error', message: 'Internal server error' });
  });
});
