import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { IoService } from "./io.service.ts";
import {
  BROWSER_OAUTH_ERROR,
  GROK_API_KEY_SECRET_KEY,
  GROK_DEVICE_CODE_URL,
  GROK_DEVICE_GRANT,
  GROK_OAUTH_CLIENT_ID,
  GROK_OAUTH_SCOPE,
  GROK_OAUTH_SECRET_KEY,
  GROK_TOKEN_URL,
  deviceCodeRequestBody,
  deviceTokenPollBody,
  grokConnectionLabel,
  nextPollInterval,
  payloadHasSecretFields,
  publicDevicePending,
  publicOauthStatus,
} from "./grok-oauth.ts";
import { resetWebSecretsForTests, webSecretGet, webSecretSet } from "./web-secrets.ts";

afterEach(() => {
  resetWebSecretsForTests();
});

test("device-code request uses the public Grok CLI client and existing scopes", () => {
  const body = deviceCodeRequestBody();
  assert.equal(GROK_DEVICE_CODE_URL, "https://auth.x.ai/oauth2/device/code");
  assert.equal(body.client_id, "b1a00492-073a-47ea-816f-4c329264a828");
  assert.equal(body.client_id, GROK_OAUTH_CLIENT_ID);
  assert.equal(body.scope, GROK_OAUTH_SCOPE);
  assert.match(body.scope, /openid/);
  assert.match(body.scope, /offline_access/);
  assert.match(body.scope, /grok-cli:access/);
  assert.match(body.scope, /api:access/);
  assert.equal("redirect_uri" in body, false);
  assert.equal("code_challenge" in body, false);
});

test("token poll uses the RFC 8628 device_code grant", () => {
  const body = deviceTokenPollBody("pending-device");
  assert.equal(GROK_TOKEN_URL, "https://auth.x.ai/oauth2/token");
  assert.equal(body.grant_type, "urn:ietf:params:oauth:grant-type:device_code");
  assert.equal(body.grant_type, GROK_DEVICE_GRANT);
  assert.equal(body.client_id, GROK_OAUTH_CLIENT_ID);
  assert.equal(body.device_code, "pending-device");
  assert.notEqual(body.grant_type, "authorization_code");
});

test("slow_down increases the poll interval", () => {
  assert.equal(nextPollInterval(5, "authorization_pending"), 5);
  assert.equal(nextPollInterval(5, "slow_down"), 10);
  assert.equal(nextPollInterval(0, null), 1);
});

test("public OAuth status and device pending never expose tokens", () => {
  const status = publicOauthStatus({
    connected: true,
    expiresAt: 1_700_000_000,
    tokenType: "Bearer",
    access_token: "sk-should-never-surface",
    accessToken: "also-hidden",
    refresh_token: "refresh-hidden",
    device_code: "device-hidden",
  });
  assert.deepEqual(status, { connected: true, expiresAt: 1_700_000_000, tokenType: "Bearer" });
  assert.equal(payloadHasSecretFields(status), false);
  assert.doesNotMatch(JSON.stringify(status), /sk-should-never-surface|refresh-hidden|device-hidden|access_token/);

  const pending = publicDevicePending({
    userCode: "WDJB-MJHT",
    verificationUri: "https://auth.x.ai/connect",
    verificationUriComplete: "https://auth.x.ai/connect?user_code=WDJB-MJHT",
    expiresIn: 900,
    device_code: "secret-device",
    access_token: "sk-leaked",
  });
  assert.equal(pending.userCode, "WDJB-MJHT");
  assert.equal(payloadHasSecretFields(pending), false);
  assert.doesNotMatch(JSON.stringify(pending), /secret-device|sk-leaked|access_token|device_code/);
});

test("connection label is Signed in or API key saved, never the secret", () => {
  assert.equal(grokConnectionLabel({ grokOauth: true, grokApiKey: false }), "Signed in");
  assert.equal(grokConnectionLabel({ grokOauth: false, grokApiKey: true }), "API key saved");
  assert.equal(grokConnectionLabel({ grokOauth: false, grokApiKey: false }), "Not connected");
  const token = "sk-this-is-a-long-access-token-that-must-not-render";
  const label = grokConnectionLabel({ grokOauth: true, grokApiKey: true });
  assert.doesNotMatch(label, new RegExp(token));
  assert.doesNotMatch(label, /sk-|xai-[A-Za-z0-9]/);
});

test("browser preview rejects device flow and keeps paste-key fallback", async () => {
  const io = new IoService();
  await assert.rejects(() => io.grokOauthBegin(), (error: Error) => {
    assert.match(error.message, /desktop shell/);
    assert.equal(error.message, BROWSER_OAUTH_ERROR);
    return true;
  });
  await assert.rejects(() => io.grokOauthWait(), (error: Error) => {
    assert.equal(error.message, BROWSER_OAUTH_ERROR);
    return true;
  });
  const status = await io.grokOauthStatus();
  assert.deepEqual(status, { connected: false });
  assert.equal(payloadHasSecretFields(status), false);

  await io.secretSet(GROK_API_KEY_SECRET_KEY, "xai-console-developer-key");
  assert.equal(await io.secretGet(GROK_API_KEY_SECRET_KEY), "xai-console-developer-key");
  assert.equal(await io.secretGet(GROK_OAUTH_SECRET_KEY), null);
  assert.equal(webSecretGet(GROK_API_KEY_SECRET_KEY), "xai-console-developer-key");

  await io.secretDelete(GROK_API_KEY_SECRET_KEY);
  assert.equal(await io.secretGet(GROK_API_KEY_SECRET_KEY), null);
});

test("paste-key fallback does not write grok_oauth or invent a user_code", () => {
  webSecretSet(GROK_API_KEY_SECRET_KEY, "xai-preview-only");
  assert.equal(webSecretGet(GROK_OAUTH_SECRET_KEY), null);
  assert.equal(grokConnectionLabel({ grokOauth: false, grokApiKey: true }), "API key saved");
  assert.equal(payloadHasSecretFields({ userCode: "ABCD-EFGH", verificationUri: "https://auth.x.ai/connect" }), false);
});
