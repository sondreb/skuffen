import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { IoService } from "./io.service.ts";
import {
  GROK_API_KEY_SECRET_KEY,
  grokConnectionLabel,
  invokeErrorMessage,
  payloadHasSecretFields,
  publicOauthPoll,
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
      interval: 0,
    }),
    grokOauthWait: async () => ({ connected: false }),
    grokOauthPoll: async () => ({ state: "pending" as const, interval: 0, connected: false }),
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
      grokOauthPoll: async () => ({
        state: "signedIn",
        connected: publicStatus.connected,
        tokenType: publicStatus.tokenType,
        expiresAt: publicStatus.expiresAt,
      }),
      // Stale/wrong-shape status IPC must not wipe the poll result.
      grokOauthStatus: async () => ({ connected: false }),
    }),
  );
  await providers.signInGrok();
  assert.equal(providers.status().grokOauth, true);
  assert.equal(providers.signingIn(), false);
  assert.equal(providers.devicePending(), null);
  assert.equal(providers.error(), null);
  assert.equal(grokConnectionLabel(providers.status()), "Signed in");
  assert.equal(payloadHasSecretFields(providers.status()), false);
  assert.doesNotMatch(JSON.stringify(providers.status()), /sk-should-never-surface|refresh-hidden|access_token/);
});

test("failed persist after poll shows an error instead of looking signed out", async () => {
  const providers = new ProvidersService(
    mockIo({
      grokOauthPoll: async () => ({ state: "signedIn", connected: false }),
    }),
  );
  await providers.signInGrok();
  assert.equal(providers.status().grokOauth, false);
  assert.equal(providers.devicePending(), null);
  assert.equal(providers.signingIn(), false);
  assert.match(providers.error() ?? "", /did not persist/);
  assert.equal(grokConnectionLabel(providers.status()), "Not connected");
});

test("poll or keychain failure keeps a visible error and hides the user code", async () => {
  const providers = new ProvidersService(
    mockIo({
      grokOauthPoll: async () => {
        throw { message: "Could not persist the secret in the OS credential store." };
      },
    }),
  );
  await providers.signInGrok();
  assert.equal(providers.devicePending(), null);
  assert.equal(providers.status().grokOauth, false);
  assert.equal(
    providers.error(),
    "Could not persist the secret in the OS credential store.",
  );
  assert.equal(invokeErrorMessage({ message: "Grok sign-in expired. Try again." }), "Grok sign-in expired. Try again.");
});

test("pending poll then signedIn flips grokOauth without leaking secrets", async () => {
  let n = 0;
  const providers = new ProvidersService(
    mockIo({
      grokOauthPoll: async () => {
        n += 1;
        if (n === 1) return { state: "pending" as const, interval: 0, connected: false };
        return publicOauthPoll({
          state: "signedIn",
          connected: true,
          tokenType: "Bearer",
          access_token: "sk-should-never-surface",
        });
      },
    }),
  );
  await providers.signInGrok();
  assert.equal(n, 2);
  assert.equal(providers.status().grokOauth, true);
  assert.equal(grokConnectionLabel(providers.status()), "Signed in");
  assert.equal(payloadHasSecretFields(providers.status()), false);
  assert.doesNotMatch(JSON.stringify(providers.status()), /sk-should-never-surface|access_token/);
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
      grokOauthPoll: async () =>
        publicOauthPoll({ state: "signedIn", connected: true, tokenType: "Bearer" }),
    }),
  );
  await providers.signInGrok();
  assert.equal(providers.status().grokOauth, true);
  await providers.clearGrok();
  assert.equal(providers.status().grokOauth, false);
  assert.equal(grokConnectionLabel(providers.status()), "Not connected");
});
