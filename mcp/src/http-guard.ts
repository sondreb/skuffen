/**
 * Local MCP HTTP policy for the existing server in server.ts.
 * Loopback bind alone is not enough (DNS rebinding, Origin prefix CSRF,
 * X-Forwarded-* spoofing). This is not a second HTTP server.
 *
 * OS-credential tokens (service me.grok.skuffen) stay in the OS store.
 * They are never inbound HTTP auth. SKUFFEN_OKF_KEY is leftover ciphertext
 * rewrite only — not a bearer secret for this port.
 */

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

export const DEFAULT_MCP_HTTP_PORT = 8787;
export const DEFAULT_MCP_HTTP_HOST = "127.0.0.1";
export const MAX_MCP_HTTP_BODY_BYTES = 1_048_576;
export const MAX_MCP_TOOL_NAME_CHARS = 128;

/** Headers this guard may read. Forwarded and Authorization are intentionally absent. */
export const MCP_HTTP_GUARD_HEADER_KEYS = ["host", "origin", "content-type", "content-length"] as const;

const UNSPECIFIED_BIND = new Set(["0.0.0.0", "::", "[::]"]);

export type McpHttpCli = {
  port: number;
  host: string;
  httpOnly: boolean;
};

export type GuardHeaders = {
  host?: string;
  origin?: string;
  contentType?: string;
  contentLength?: string;
};

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

export function usesOsCredentialHttpAuth(): false {
  return false;
}

export function resolveBindHost(requested?: string | null): string {
  const raw = (requested ?? "").trim();
  const host = raw === "" ? DEFAULT_MCP_HTTP_HOST : stripBrackets(raw);
  if (UNSPECIFIED_BIND.has(raw) || UNSPECIFIED_BIND.has(host)) {
    throw new Error(`Refusing to bind local MCP HTTP to ${raw || host}. Use 127.0.0.1 or ::1.`);
  }
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`Refusing to bind local MCP HTTP to ${raw || host}. Loopback only (127.0.0.1 or ::1).`);
  }
  return host;
}

export function parseMcpHttpCli(argv: readonly string[]): McpHttpCli | null {
  const httpFlag = argv.findIndex((arg) => arg === "--http");
  if (httpFlag < 0) return null;
  return {
    port: parseListenPort(argv, httpFlag),
    host: resolveBindHost(flagValue(argv, "--http-host")),
    httpOnly: argv.includes("--http-only"),
  };
}

export function allowedOrigins(port: number): readonly string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

export function parseHostHeader(hostHeader: string): { hostname: string; port?: number } | null {
  const raw = hostHeader.trim();
  if (!raw || raw.includes("/") || raw.includes("@") || raw.includes(" ")) return null;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end < 0) return null;
    const hostname = raw.slice(1, end);
    if (!hostname) return null;
    const rest = raw.slice(end + 1);
    if (rest === "") return { hostname };
    if (!rest.startsWith(":")) return null;
    const port = parsePortNumber(rest.slice(1));
    return port === undefined ? null : { hostname, port };
  }
  const firstColon = raw.indexOf(":");
  const lastColon = raw.lastIndexOf(":");
  if (firstColon >= 0 && firstColon !== lastColon) {
    return { hostname: raw };
  }
  if (firstColon >= 0) {
    const hostname = raw.slice(0, firstColon);
    const port = parsePortNumber(raw.slice(firstColon + 1));
    if (!hostname || port === undefined) return null;
    return { hostname, port };
  }
  return { hostname: raw };
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = stripBrackets(hostname.trim()).toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "localhost." || host === "::1";
}

export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  if (!isLoopbackHostname(parsed.hostname)) return false;
  if (parsed.port !== undefined && parsed.port !== port) return false;
  return true;
}

/**
 * Exact Origin match of scheme+host+port against the allowlist.
 * Uses `===`, never `startsWith` / prefix (PraisonAI-style CSRF).
 * Missing Origin is allowed for curl / MCP clients. Present Origin must match.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined || origin === "") return true;
  return allowedOrigins(port).some((allowed) => allowed === origin);
}

export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const media = contentType.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

/** Drop X-Forwarded-* / Forwarded. Local MCP never sits behind a proxy. */
export function requestHeadersForGuard(headers: IncomingHttpHeaders): GuardHeaders {
  return {
    host: singleHeader(headers.host),
    origin: singleHeader(headers.origin),
    contentType: singleHeader(headers["content-type"]),
    contentLength: singleHeader(headers["content-length"]),
  };
}

export function evaluateLocalMcpHttp(
  input: { method: string; headers: IncomingHttpHeaders },
  ctx: { bindHost: string; port: number },
): GuardResult {
  try {
    resolveBindHost(ctx.bindHost);
  } catch {
    return { ok: false, status: 500, error: "invalid bind" };
  }

  const headers = requestHeadersForGuard(input.headers);
  if (!hostAllowed(headers.host, ctx.port)) {
    return { ok: false, status: 421, error: "invalid host" };
  }
  if (!originAllowed(headers.origin, ctx.port)) {
    return { ok: false, status: 403, error: "invalid origin" };
  }
  if (input.method.toUpperCase() === "POST" && !isJsonContentType(headers.contentType)) {
    return { ok: false, status: 415, error: "content-type must be application/json" };
  }
  if (headers.contentLength !== undefined) {
    const length = Number(headers.contentLength);
    if (!Number.isFinite(length) || length < 0) {
      return { ok: false, status: 400, error: "invalid content-length" };
    }
    if (length > MAX_MCP_HTTP_BODY_BYTES) {
      return { ok: false, status: 413, error: "payload too large" };
    }
  }
  return { ok: true };
}

export function formatBindHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

export function readCappedBody(req: IncomingMessage, maxBytes = MAX_MCP_HTTP_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    const fail = (error: Error & { status?: number }) => {
      if (rejected) return;
      rejected = true;
      req.destroy();
      reject(error);
    };
    req.on("data", (chunk) => {
      const buf = Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        const error = new Error("payload too large") as Error & { status?: number };
        error.status = 413;
        fail(error);
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function parsePortNumber(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return port;
}

function parseListenPort(argv: readonly string[], httpFlag: number): number {
  const next = argv[httpFlag + 1];
  if (next === undefined || next.startsWith("-")) return DEFAULT_MCP_HTTP_PORT;
  const port = Number(next);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --http port: ${next}`);
  }
  return port;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.findIndex((arg) => arg === flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing ${flag} value`);
  }
  return value;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}
