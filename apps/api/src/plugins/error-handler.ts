import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { isUniqueViolation } from '../lib/db-retry';
import { AccountDeactivatedError, AppError, AuthenticationError } from '../lib/errors';
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
    // The auth hook is global (it runs for public routes such as /health), so
    // it cannot throw — it records WHY it refused an otherwise valid token on
    // the request instead. Translate the generic 401 that routes throw into
    // the specific reason here, in one place, rather than at each of the ~396
    // `throw new AuthenticationError()` call sites.
    if (err instanceof AuthenticationError && req.authRejectedReason === 'inactive') {
      const deactivated = new AccountDeactivatedError();
      reply.code(deactivated.statusCode).send({
        error: deactivated.code,
        message: deactivated.message,
      });
      return;
    }

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

    // A raw Postgres unique_violation (SQLSTATE 23505) reaches here when
    // withUniqueRetry exhausts its attempts. Map it to 409 rather than 500.
    if (isUniqueViolation(err)) {
      reply.code(409).send({
        error: 'conflict',
        message: 'A record with this value already exists',
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
