// Domain errors thrown from the service layer. The error-handler plugin
// maps each to its HTTP status. Any error not in this hierarchy is treated
// as an unhandled 500 and logged at error level.

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(401, 'unauthorized', message, details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(403, 'forbidden', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super(404, 'not_found', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, 'validation_error', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, 'conflict', message, details);
  }
}
