/**
 * Typed application errors.
 *
 * A route signals a problem by throwing an `AppError` with an HTTP status and a
 * stable machine-readable code. The error handler turns that into the same JSON
 * envelope everywhere, so the client never has to guess. An error that is *not*
 * an `AppError` is a bug, and is reported as a generic 500 with the detail kept
 * in the server log rather than sent to the caller — stack traces and SQL are
 * not the caller's business.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;
  /** Set when retrying the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, detail?: unknown, retryable = false) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryable = retryable;
  }

  static badRequest(message: string, detail?: unknown) {
    return new AppError(400, 'bad_request', message, detail);
  }
  static unauthenticated(message = 'Sign in to continue.') {
    return new AppError(401, 'unauthenticated', message);
  }
  static forbidden(message = 'You do not have access to that.') {
    return new AppError(403, 'forbidden', message);
  }
  static notFound(message = 'Not found.') {
    return new AppError(404, 'not_found', message);
  }
  static conflict(code: string, message: string, detail?: unknown) {
    return new AppError(409, code, message, detail);
  }
  static unprocessable(code: string, message: string, detail?: unknown) {
    return new AppError(422, code, message, detail);
  }
  static tooManyRequests(message: string, retryAfterSeconds?: number) {
    return new AppError(429, 'rate_limited', message, retryAfterSeconds === undefined ? undefined : { retryAfterSeconds }, true);
  }
  static unavailable(message: string, detail?: unknown) {
    return new AppError(503, 'service_unavailable', message, detail, true);
  }
  static internal(message = 'Something went wrong on our side.', detail?: unknown) {
    return new AppError(500, 'server_error', message, detail);
  }
}

/** Raised when a dependency (PSP, carrier, SMS) fails in a way we can retry. */
export class ProviderError extends AppError {
  readonly provider: string;
  readonly cause?: unknown;

  constructor(provider: string, message: string, options: { status?: number; retryable?: boolean; cause?: unknown; detail?: unknown } = {}) {
    super(options.status ?? 502, 'provider_error', message, options.detail ?? { provider }, options.retryable ?? true);
    this.name = 'ProviderError';
    this.provider = provider;
    this.cause = options.cause;
  }
}

/** Raised when a request must not be retried as-is (bad input, failed policy). */
export class ValidationError extends AppError {
  readonly issues: { field: string; message: string }[];

  constructor(message: string, issues: { field: string; message: string }[] = []) {
    super(422, 'validation_failed', message, issues.length ? { issues } : undefined);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
