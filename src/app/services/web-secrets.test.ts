import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  WEB_SECRETS_STORAGE_KEY,
  purgeDurableBrowserSecrets,
  resetWebSecretsForTests,
  webSecretDelete,
  webSecretGet,
  webSecretSet,
} from "./web-secrets.ts";

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
const sessionStorageMock = mockStorage();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorageMock, configurable: true });

afterEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
  resetWebSecretsForTests();
});

test("browser secrets stay in memory and never write localStorage or sessionStorage", () => {
  webSecretSet("grok_api_key", "xai-preview-only");
  webSecretSet("gemini_api_key", "AIza-preview-only");

  assert.equal(webSecretGet("grok_api_key"), "xai-preview-only");
  assert.equal(webSecretGet("gemini_api_key"), "AIza-preview-only");
  assert.equal(localStorageMock.getItem(WEB_SECRETS_STORAGE_KEY), null);
  assert.equal(sessionStorageMock.getItem(WEB_SECRETS_STORAGE_KEY), null);
  assert.equal(localStorageMock.length, 0);
  assert.equal(sessionStorageMock.length, 0);
});

test("first access wipes leftover durable skuffen.secrets keys", () => {
  localStorageMock.setItem(WEB_SECRETS_STORAGE_KEY, JSON.stringify({ grok_api_key: "leaked" }));
  sessionStorageMock.setItem(WEB_SECRETS_STORAGE_KEY, JSON.stringify({ gemini_api_key: "also-leaked" }));

  assert.equal(webSecretGet("grok_api_key"), null);
  assert.equal(localStorageMock.getItem(WEB_SECRETS_STORAGE_KEY), null);
  assert.equal(sessionStorageMock.getItem(WEB_SECRETS_STORAGE_KEY), null);
});

test("delete only affects the in-memory map", () => {
  webSecretSet("grok_oauth", '{"access_token":"tmp"}');
  webSecretDelete("grok_oauth");
  assert.equal(webSecretGet("grok_oauth"), null);
  assert.equal(localStorageMock.getItem(WEB_SECRETS_STORAGE_KEY), null);
});

test("purgeDurableBrowserSecrets is a no-op when Storage is absent", () => {
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: undefined, configurable: true });
  assert.doesNotThrow(() => purgeDurableBrowserSecrets());
  if (originalLocal) Object.defineProperty(globalThis, "localStorage", originalLocal);
  if (originalSession) Object.defineProperty(globalThis, "sessionStorage", originalSession);
});
