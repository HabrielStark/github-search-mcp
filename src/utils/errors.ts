/** Structured error codes and the AppError class used across the server. */

export const ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_REPOSITORY_FORMAT",
  "GITHUB_RATE_LIMITED",
  "GITHUB_NOT_FOUND",
  "GITHUB_FORBIDDEN",
  "GITHUB_API_ERROR",
  "README_NOT_FOUND",
  "LICENSE_NOT_FOUND",
  "FILE_TOO_LARGE",
  "BINARY_FILE_NOT_SUPPORTED",
  "CACHE_ERROR",
  "DEEPWIKI_DISABLED",
  "DEEPWIKI_UNAVAILABLE",
  "FORBIDDEN_HOST",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryAfter: string | null;
  details?: unknown;
}

export interface ErrorResponse {
  error: ErrorPayload;
}

export interface AppErrorOptions {
  retryAfter?: string | null;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter: string | null;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.retryAfter = options.retryAfter ?? null;
    this.details = options.details;
  }
}

/** Convert any thrown value into a structured error response. */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        retryAfter: err.retryAfter,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: { code: "INTERNAL_ERROR", message, retryAfter: null } };
}
