import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "./utils/logger.js";

export interface HttpServerHandle {
  port: number;
  url: string;
  /** Number of currently-tracked sessions (for monitoring/tests). */
  sessionCount(): number;
  close(): Promise<void>;
}

export interface StartHttpServerOptions {
  /** Factory that builds a fresh McpServer (sharing the server context) per session. */
  createMcpServer: () => McpServer;
  port: number;
  /** Defaults to 127.0.0.1 (loopback). The HTTP transport is UNAUTHENTICATED. */
  host?: string;
  logger: Logger;
  /** Max request body size (Content-Length) in bytes. Default 1 MB. */
  maxBodyBytes?: number;
  /** Max concurrent sessions before new ones are rejected. Default 256. */
  maxSessions?: number;
  /** Idle session time-to-live in ms before it is swept/closed. Default 30 min. */
  sessionTtlMs?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;

function writeJsonError(res: ServerResponse, status: number, code: string, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code, message } }));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isAllowedHostHeader(
  value: string | string[] | undefined,
  allowedHosts: string[],
): boolean {
  const hostHeader = headerValue(value)?.toLowerCase();
  return Boolean(hostHeader && allowedHosts.includes(hostHeader));
}

/**
 * Start a Streamable HTTP transport at POST/GET/DELETE /mcp using per-session
 * transports (MCP stateful mode with JSON responses).
 *
 * SECURITY: this endpoint has NO authentication. It binds to loopback
 * (127.0.0.1) by default and is intended for local clients only. Do not expose
 * it on a public interface without an authenticating reverse proxy.
 */
export async function startHttpServer(options: StartHttpServerOptions): Promise<HttpServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  interface Session {
    transport: StreamableHTTPServerTransport;
    lastSeen: number;
  }
  const sessions = new Map<string, Session>();

  // Sweep idle sessions: a client that initializes then vanishes (never sends a
  // DELETE) must not leak a session forever and eventually exhaust maxSessions.
  const sweepEveryMs = Math.max(1_000, Math.min(sessionTtlMs, 60_000));
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - sessionTtlMs;
    for (const [id, s] of sessions) {
      if (s.lastSeen <= cutoff) {
        sessions.delete(id);
        void s.transport.close().catch(() => undefined);
      }
    }
  }, sweepEveryMs);
  (sweeper as { unref?: () => void }).unref?.();

  // Pinned after listen() resolves the real port; used for DNS-rebinding defense.
  let allowedHosts: string[] = [];

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
      if (!isAllowedHostHeader(req.headers.host, allowedHosts)) {
        writeJsonError(
          res,
          403,
          "FORBIDDEN_HOST",
          "Host header is not allowed for this local HTTP transport.",
        );
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: { code: "NOT_FOUND", message: "Use the /mcp endpoint." } }),
        );
        return;
      }

      // DoS defense: reject oversized bodies by Content-Length. (A
      // streamed byte-counter was tried but interferes with the SDK transport's
      // own body read; the endpoint is loopback-only, which bounds the residual.)
      const lenRaw = req.headers["content-length"];
      if (typeof lenRaw === "string" && lenRaw.trim() !== "") {
        const len = Number(lenRaw);
        if (Number.isFinite(len) && len > maxBodyBytes) {
          writeJsonError(
            res,
            413,
            "INVALID_INPUT",
            `Request body exceeds the ${maxBodyBytes}-byte limit.`,
          );
          return;
        }
      }

      const sessionId = headerValue(req.headers["mcp-session-id"]);
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      let transport = existing?.transport;
      if (existing) existing.lastSeen = Date.now();

      if (!transport) {
        if (req.method !== "POST") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { code: "INVALID_INPUT", message: "Missing or unknown session." },
            }),
          );
          return;
        }
        // Memory defense: cap concurrent sessions so abandoned/leaked sessions
        // cannot grow the map without bound on a long-running server.
        if (sessions.size >= maxSessions) {
          writeJsonError(
            res,
            503,
            "INTERNAL_ERROR",
            "Too many active sessions; please retry later.",
          );
          return;
        }
        const server = options.createMcpServer();
        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          // DNS-rebinding defense: reject requests whose Host header isn't one of
          // our loopback bindings, so a malicious web page can't drive this
          // unauthenticated localhost endpoint from a victim's browser.
          enableDnsRebindingProtection: true,
          allowedHosts,
          onsessioninitialized: (id) => {
            sessions.set(id, { transport: created, lastSeen: Date.now() });
          },
        });
        created.onclose = () => {
          const id = created.sessionId;
          if (id) sessions.delete(id);
        };
        await server.connect(created);
        transport = created;
      }

      await transport.handleRequest(req, res);
    } catch (err) {
      options.logger.error("http request failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Internal error." } }));
      } else if (!res.writableEnded) {
        // Headers already sent (streamed) — can't write a clean error, so tear
        // the socket down rather than leave the client hanging until timeout.
        res.destroy();
      }
    }
  }

  const httpServer = createHttpServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      // Listen failed (EADDRINUSE/EACCES/...): release the sweeper and socket so
      // we don't leak resources, then surface the error to the caller.
      clearInterval(sweeper);
      httpServer.close(() => undefined);
      reject(err);
    };
    httpServer.once("error", onError);
    httpServer.listen(options.port, host, () => {
      httpServer.removeListener("error", onError);
      resolve();
    });
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  allowedHosts = [`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`].map((h) =>
    h.toLowerCase(),
  );
  // Keep a persistent error handler for the server's lifetime so a later socket
  // error doesn't become an uncaught exception that crashes the process.
  httpServer.on("error", (err: Error) => {
    options.logger.error("http server error", { error: err.message });
  });
  const url = `http://${host}:${port}/mcp`;
  options.logger.info("HTTP transport listening", { url, auth: "none (localhost only)" });

  return {
    port,
    url,
    sessionCount: () => sessions.size,
    close: async () => {
      clearInterval(sweeper);
      for (const { transport } of sessions.values()) {
        await transport.close().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
