import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { IoService } from "./io.service.ts";
import {
  GROK_API_KEY_SECRET_KEY,
  grokConnectionLabel,
  payloadHasSecretFields,
  publicOauthStatus,
} from "./grok-oauth.ts";
import { ProvidersService } from "./providers.service.ts";
import { resetWebSecretsForTests } from "./web-secrets.ts";

function mockStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

const localStorageMock = mockStorage();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: mockStorage(), configurable: true });

afterEach(() => {
  localStorageMock.clear();
  resetWebSecretsForTests();
});

function mockIo(overrides: Partial<IoService> = {}): IoService {
  return {
    getSettings: async () => ({}),
    secretGet: async () => null,
    secretDelete: async () => undefined,
    grokOauthBegin: async () => ({
      userCode: "WDJB-MJHT",
      verificationUri: "https://auth.x.ai/connect",
      expiresIn: 900,
    }),
    grokOauthWait: async () => ({ connected: false }),
    grokOauthStatus: async () => ({ connected: false }),
    grokOauthLogout: async () => undefined,
    ...overrides,
  } as IoService;
}

test("mocked successful device-token poll flips grokOauth without leaking secrets", async () => {
  const pollPayload = {
    access_token: "sk-should-never-surface",
    refresh_token: "refresh-hidden",
    token_type: "Bearer",
    expires_in: 3600,
  };
  const publicStatus = publicOauthStatus(pollPayload);
  assert.equal(publicStatus.connected, true);
  assert.equal(payloadHasSecretFields(publicStatus), false);
  assert.doesNotMatch(JSON.stringify(publicStatus), /sk-should-never-surface|refresh-hidden|access_token/);

  const providers = new ProvidersService(
    mockIo({
      grokOauthWait: async () => publicStatus,
      // Stale/wrong-shape status IPC must not wipe the poll result.
      grokOauthStatus: async () => ({ connected: false }),
    }),
  );
  await providers.signInGrok();
  assert.equal(providers.status().grokOauth, true);
  assert.equal(providers.signingIn(), false);
  assert.equal(providers.devicePending(), null);
  assert.equal(grokConnectionLabel(providers.status()), "Signed in");
  assert.equal(payloadHasSecretFields(providers.status()), false);
  assert.doesNotMatch(JSON.stringify(providers.status()), /sk-should-never-surface|refresh-hidden|access_token/);
});

test("browser preview refresh shows API key saved from in-memory key", async () => {
  const io = new IoService();
  await io.secretSet(GROK_API_KEY_SECRET_KEY, "xai-console-developer-key");
  const providers = new ProvidersService(io);
  await providers.refresh();
  assert.equal(providers.status().grokOauth, false);
  assert.equal(providers.status().grokApiKey, true);
  assert.equal(grokConnectionLabel(providers.status()), "API key saved");
  assert.equal(payloadHasSecretFields(providers.status()), false);
  assert.doesNotMatch(JSON.stringify(providers.status()), /xai-console-developer-key/);
});

test("sign out clears grokOauth after a mocked poll", async () => {
  const providers = new ProvidersService(
    mockIo({
      grokOauthWait: async () => publicOauthStatus({ connected: true, tokenType: "Bearer" }),
    }),
  );
  await providers.signInGrok();
  assert.equal(providers.status().grokOauth, true);
  await providers.clearGrok();
  assert.equal(providers.status().grokOauth, false);
  assert.equal(grokConnectionLabel(providers.status()), "Not connected");
});
