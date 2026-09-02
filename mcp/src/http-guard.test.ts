import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  allowedOrigins,
  evaluateLocalMcpHttp,
  hostAllowed,
  isJsonContentType,
  MAX_MCP_HTTP_BODY_BYTES,
  MCP_HTTP_GUARD_HEADER_KEYS,
  originAllowed,
  parseHostHeader,
  parseMcpHttpCli,
  readCappedBody,
  resolveBindHost,
  usesOsCredentialHttpAuth,
} from "./http-guard.ts";

const ctx = { bindHost: "127.0.0.1", port: 8787 } as const;

function decide(
  method: string,
  headers: Record<string, string | string[] | undefined>,
  bind = ctx,
) {
  return evaluateLocalMcpHttp({ method, headers }, bind);
}

test("hard-bind refuses 0.0.0.0 and :: defaults; only 127.0.0.1 / ::1", () => {
  assert.equal(resolveBindHost(undefined), "127.0.0.1");
  assert.equal(resolveBindHost(""), "127.0.0.1");
  assert.equal(resolveBindHost("127.0.0.1"), "127.0.0.1");
  assert.equal(resolveBindHost("::1"), "::1");
  assert.equal(resolveBindHost("[::1]"), "::1");
  assert.throws(() => resolveBindHost("0.0.0.0"), /Refusing/);
  assert.throws(() => resolveBindHost("::"), /Refusing/);
  assert.throws(() => resolveBindHost("[::]"), /Refusing/);
  assert.throws(() => resolveBindHost("localhost"), /Refusing/);
  assert.throws(() => resolveBindHost("192.168.1.10"), /Refusing/);
  assert.throws(() => resolveBindHost("10.0.0.1"), /Refusing/);
  assert.deepEqual(parseMcpHttpCli(["--http", "8787"]), {
    port: 8787,
    host: "127.0.0.1",
    httpOnly: false,
  });
  assert.deepEqual(parseMcpHttpCli(["--http", "9090", "--http-host", "::1", "--http-only"]), {
    port: 9090,
    host: "::1",
    httpOnly: true,
  });
  assert.throws(() => parseMcpHttpCli(["--http", "8787", "--http-host", "0.0.0.0"]), /Refusing/);
  assert.throws(() => parseMcpHttpCli(["--http", "8787", "--http-host", "::"]), /Refusing/);
  assert.equal(parseMcpHttpCli(["--http-only"]), null);
});

test("rejects non-loopback Host on loopback binds (DNS rebinding)", () => {
  assert.equal(hostAllowed("127.0.0.1:8787", 8787), true);
  assert.equal(hostAllowed("localhost:8787", 8787), true);
  assert.equal(hostAllowed("[::1]:8787", 8787), true);
  assert.equal(hostAllowed("127.0.0.1", 8787), true);
  assert.equal(hostAllowed("evil.com", 8787), false);
  assert.equal(hostAllowed("evil.com:8787", 8787), false);
  assert.equal(hostAllowed("127.0.0.1.attacker.com:8787", 8787), false);
  assert.equal(hostAllowed("0.0.0.0:8787", 8787), false);
  assert.equal(hostAllowed("192.168.1.10:8787", 8787), false);
  assert.equal(hostAllowed("127.0.0.1:9999", 8787), false);
  assert.equal(hostAllowed(undefined, 8787), false);
  assert.equal(parseHostHeader("127.0.0.1:8787")?.hostname, "127.0.0.1");
  assert.equal(decide("GET", { host: "evil.example:8787" }).ok, false);
  assert.equal(decide("GET", { host: "evil.example:8787" }).status, 421);
  assert.equal(decide("GET", { host: "127.0.0.1:8787" }).ok, true);
  assert.equal(decide("GET", { host: ["evil.com:8787", "127.0.0.1:8787"] }).ok, false);
});

test("Origin match is exact scheme+host+port, never prefix/startswith", () => {
  assert.deepEqual(allowedOrigins(8787), [
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://[::1]:8787",
  ]);
  assert.equal(originAllowed(undefined, 8787), true);
  assert.equal(originAllowed("", 8787), true);
  assert.equal(originAllowed("http://127.0.0.1:8787", 8787), true);
  assert.equal(originAllowed("http://localhost:8787", 8787), true);
  assert.equal(originAllowed("http://[::1]:8787", 8787), true);

  const prefixSpoofs = [
    "http://127.0.0.1:8787.evil.com",
    "http://127.0.0.1.evil.com:8787",
    "http://localhost:8787.attacker.com",
    "http://localhost.evil.com:8787",
    "http://127.0.0.1:8787/",
    "https://127.0.0.1:8787",
    "http://127.0.0.1:9999",
    "http://127.0.0.1",
    "null",
  ];
  for (const origin of prefixSpoofs) {
    assert.equal(originAllowed(origin, 8787), false, origin);
  }
  // startsWith would accept this DNS/CSRF spoof; exact === must not.
  assert.equal("http://127.0.0.1:8787.evil.com".startsWith("http://127.0.0.1:8787"), true);
  assert.equal(originAllowed("http://127.0.0.1:8787.evil.com", 8787), false);

  const rejected = decide("GET", {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787.evil.com",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);
  assert.equal(
    decide("GET", { host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787" }).ok,
    true,
  );
});

test("X-Forwarded-* is ignored on local MCP", () => {
  const rebound = decide("GET", {
    host: "evil.com:8787",
    "x-forwarded-host": "127.0.0.1:8787",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-port": "8787",
    forwarded: "host=127.0.0.1:8787;proto=http",
  });
  assert.equal(rebound.ok, false);
  assert.equal(rebound.status, 421);

  const httpsSpoof = decide("POST", {
    host: "127.0.0.1:8787",
    origin: "https://127.0.0.1:8787",
    "content-type": "application/json",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "127.0.0.1:8787",
  });
  assert.equal(httpsSpoof.ok, false);
  assert.equal(httpsSpoof.status, 403);

  const honest = decide("POST", {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787",
    "content-type": "application/json",
    "x-forwarded-host": "evil.com",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "8.8.8.8",
  });
  assert.equal(honest.ok, true);
  assert.ok(!MCP_HTTP_GUARD_HEADER_KEYS.some((key) => key.startsWith("x-forwarded")));
  assert.ok(!MCP_HTTP_GUARD_HEADER_KEYS.includes("forwarded" as (typeof MCP_HTTP_GUARD_HEADER_KEYS)[number]));
});

test("POST requires Content-Type application/json; text/plain JSON-RPC is rejected", () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
  assert.equal(isJsonContentType("application/json;charset=UTF-8"), true);
  assert.equal(isJsonContentType("text/plain"), false);
  assert.equal(isJsonContentType("text/plain; charset=utf-8"), false);
  assert.equal(isJsonContentType("application/jsonp"), false);
  assert.equal(isJsonContentType("application/json-rpc"), false);
  assert.equal(isJsonContentType(undefined), false);

  const json = decide("POST", {
    host: "127.0.0.1:8787",
    "content-type": "application/json",
  });
  assert.equal(json.ok, true);

  const plain = decide("POST", {
    host: "127.0.0.1:8787",
    "content-type": "text/plain",
  });
  assert.equal(plain.ok, false);
  assert.equal(plain.status, 415);

  const missing = decide("POST", { host: "127.0.0.1:8787" });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 415);

  assert.equal(decide("GET", { host: "127.0.0.1:8787" }).ok, true);
});

test("OS-credential tokens are not treated as inbound HTTP auth", () => {
  assert.equal(usesOsCredentialHttpAuth(), false);
  assert.ok(!MCP_HTTP_GUARD_HEADER_KEYS.includes("authorization" as (typeof MCP_HTTP_GUARD_HEADER_KEYS)[number]));
  const headers = {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787",
    "content-type": "application/json",
  };
  assert.equal(decide("POST", headers).ok, true);
  assert.equal(decide("POST", { ...headers, authorization: "Bearer os-credential-token" }).ok, true);
  assert.equal(decide("POST", { ...headers, authorization: "Bearer wrong" }).ok, true);
  assert.equal(decide("POST", { ...headers, "x-api-key": "me.grok.skuffen" }).ok, true);
});

test("optional body cap rejects oversized list_tools / session payloads", () => {
  const oversized = decide("POST", {
    host: "127.0.0.1:8787",
    "content-type": "application/json",
    "content-length": String(MAX_MCP_HTTP_BODY_BYTES + 1),
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.status, 413);

  const ok = decide("POST", {
    host: "127.0.0.1:8787",
    "content-type": "application/json",
    "content-length": "32",
  });
  assert.equal(ok.ok, true);
});

test("readCappedBody enforces the payload cap", async () => {
  const stream = new PassThrough();
  const pending = readCappedBody(stream as unknown as IncomingMessage, 8);
  stream.write("0123456789");
  stream.end();
  await assert.rejects(pending, /payload too large/);
});
