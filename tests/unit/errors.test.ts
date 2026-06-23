import { describe, it, expect } from "vitest";
import { AppError, toErrorResponse, ERROR_CODES } from "../../src/utils/errors.js";

describe("AppError", () => {
  it("carries code, retryAfter and details", () => {
    const err = new AppError("GITHUB_RATE_LIMITED", "limited", {
      retryAfter: "2030-01-01T00:00:00Z",
      details: { status: 403 },
    });
    expect(err.code).toBe("GITHUB_RATE_LIMITED");
    expect(err.retryAfter).toBe("2030-01-01T00:00:00Z");
    expect(err.details).toEqual({ status: 403 });
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults retryAfter to null", () => {
    expect(new AppError("INTERNAL_ERROR", "x").retryAfter).toBeNull();
  });

  it("sets the error name to AppError", () => {
    expect(new AppError("INTERNAL_ERROR", "x").name).toBe("AppError");
  });

  it("forwards an explicit cause and installs no cause property when absent", () => {
    const root = new Error("root");
    expect(new AppError("GITHUB_API_ERROR", "wrap", { cause: root }).cause).toBe(root);
    // No cause provided → the Error must not carry an own `cause` property at all
    // (distinguishes `{ cause: undefined }` from `undefined` options).
    const noCause = new AppError("GITHUB_API_ERROR", "x");
    expect(noCause.cause).toBeUndefined();
    expect("cause" in noCause).toBe(false);
  });
});

describe("toErrorResponse", () => {
  it("maps an AppError to a structured response", () => {
    const res = toErrorResponse(new AppError("GITHUB_NOT_FOUND", "missing"));
    expect(res).toEqual({
      error: { code: "GITHUB_NOT_FOUND", message: "missing", retryAfter: null },
    });
  });

  it("includes details when present", () => {
    const res = toErrorResponse(
      new AppError("GITHUB_API_ERROR", "bad", { details: { status: 500 } }),
    );
    expect(res.error.details).toEqual({ status: 500 });
  });

  it("omits the details key entirely when no details are present", () => {
    const res = toErrorResponse(new AppError("GITHUB_NOT_FOUND", "missing"));
    expect("details" in res.error).toBe(false);
  });

  it("maps unknown errors to INTERNAL_ERROR", () => {
    expect(toErrorResponse(new Error("boom")).error).toEqual({
      code: "INTERNAL_ERROR",
      message: "boom",
      retryAfter: null,
    });
    expect(toErrorResponse("weird").error.code).toBe("INTERNAL_ERROR");
  });

  it("defines all error codes", () => {
    for (const code of [
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
      "INTERNAL_ERROR",
    ] as const) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});
