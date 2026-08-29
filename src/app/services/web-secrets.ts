/** Durable-storage key used by v1 browser preview. Never write here again. */
export const WEB_SECRETS_STORAGE_KEY = "skuffen.secrets";

const memorySecrets: Record<string, string> = {};
let durablePurged = false;

function storageOf(name: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    const storage = (globalThis as unknown as Record<string, Storage | undefined>)[name];
    if (!storage || typeof storage.getItem !== "function") return undefined;
    return storage;
  } catch {
    return undefined;
  }
}

/** Drop leftover provider secrets from durable browser storage. Safe if Storage is missing. */
export function purgeDurableBrowserSecrets(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    storageOf(name)?.removeItem(WEB_SECRETS_STORAGE_KEY);
  }
  durablePurged = true;
}

function ensureEphemeral(): void {
  if (!durablePurged) purgeDurableBrowserSecrets();
}

export function webSecretGet(key: string): string | null {
  ensureEphemeral();
  return memorySecrets[key] ?? null;
}

export function webSecretSet(key: string, value: string): void {
  ensureEphemeral();
  memorySecrets[key] = value;
}

export function webSecretDelete(key: string): void {
  ensureEphemeral();
  delete memorySecrets[key];
}

/** Test-only: wipe the in-memory map so cases do not leak across files. */
export function resetWebSecretsForTests(): void {
  for (const key of Object.keys(memorySecrets)) delete memorySecrets[key];
  durablePurged = false;
}
