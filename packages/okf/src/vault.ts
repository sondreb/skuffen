/**
 * OKF-at-rest file format. AES-256-GCM per file, path-bound AAD.
 * Paths stay the same (file path is identity). Bytes on disk are ciphertext.
 *
 * Layout: SKUF1 | version(1) | nonce(12) | ciphertext | tag(16)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VAULT_MAGIC = "SKUF1";
export const VAULT_VERSION = 1;
export const VAULT_META_NAME = ".skuffen-vault.json";
export const VAULT_KEY_ID = "okf-master-key";
export const VAULT_SERVICE = "me.grok.skuffen";
export const AES_KEY_BYTES = 32;
export const AES_NONCE_BYTES = 12;
export const AES_TAG_BYTES = 16;

export const ENCRYPTED_BUNDLE_MESSAGE =
  "This OKF bundle is encrypted at rest. Export plaintext OKF from the Skuffen desktop app, or set SKUFFEN_OKF_KEY to the base64 vault key from the OS keychain (service me.grok.skuffen, account okf-master-key). Never upload the key, the graph, or tokens.";

export class EncryptedBundleError extends Error {
  constructor(message = ENCRYPTED_BUNDLE_MESSAGE) {
    super(message);
    this.name = "EncryptedBundleError";
  }
}

export interface VaultMeta {
  format: "skuffen-okf-vault";
  version: 1;
  cipher: "aes-256-gcm";
  keyId: typeof VAULT_KEY_ID;
  encrypted: true;
}

export function vaultMetaDocument(): VaultMeta {
  return {
    format: "skuffen-okf-vault",
    version: 1,
    cipher: "aes-256-gcm",
    keyId: VAULT_KEY_ID,
    encrypted: true,
  };
}

export function normalizeVaultPath(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function generateKey(): Uint8Array {
  return randomBytes(AES_KEY_BYTES);
}

export function encodeKey(key: Uint8Array): string {
  return Buffer.from(key).toString("base64");
}

export function decodeKey(value: string): Uint8Array {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`Vault key must be ${AES_KEY_BYTES} bytes (base64-encoded)`);
  }
  return key;
}

export function isEncrypted(bytes: Uint8Array): boolean {
  if (bytes.length < VAULT_MAGIC.length + 1 + AES_NONCE_BYTES + AES_TAG_BYTES) return false;
  return Buffer.from(bytes.subarray(0, VAULT_MAGIC.length)).toString("ascii") === VAULT_MAGIC;
}

export function encryptBytes(
  key: Uint8Array,
  relPath: string,
  plaintext: Uint8Array,
  nonce?: Uint8Array,
): Uint8Array {
  if (key.length !== AES_KEY_BYTES) throw new Error("AES-256 key must be 32 bytes");
  const iv = nonce ? Buffer.from(nonce) : randomBytes(AES_NONCE_BYTES);
  if (iv.length !== AES_NONCE_BYTES) throw new Error("AES-GCM nonce must be 12 bytes");
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  cipher.setAAD(Buffer.from(normalizeVaultPath(relPath), "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(VAULT_MAGIC, "ascii"), Buffer.from([VAULT_VERSION]), iv, encrypted, tag]);
}

export function decryptBytes(key: Uint8Array, relPath: string, sealed: Uint8Array): Uint8Array {
  if (!isEncrypted(sealed)) {
    throw new Error(`File ${relPath} is not a Skuffen vault object`);
  }
  if (key.length !== AES_KEY_BYTES) throw new Error("AES-256 key must be 32 bytes");
  const version = sealed[VAULT_MAGIC.length];
  if (version !== VAULT_VERSION) {
    throw new Error(`Unsupported vault version ${version}`);
  }
  const nonceStart = VAULT_MAGIC.length + 1;
  const nonceEnd = nonceStart + AES_NONCE_BYTES;
  const tagStart = sealed.length - AES_TAG_BYTES;
  if (tagStart < nonceEnd) throw new Error(`File ${relPath} is truncated`);
  const iv = Buffer.from(sealed.subarray(nonceStart, nonceEnd));
  const ciphertext = Buffer.from(sealed.subarray(nonceEnd, tagStart));
  const tag = Buffer.from(sealed.subarray(tagStart));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
  decipher.setAAD(Buffer.from(normalizeVaultPath(relPath), "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(`Could not decrypt ${relPath}. Wrong key, or the file was moved.`);
  }
}

export function vaultKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Uint8Array | null {
  const raw = env.SKUFFEN_OKF_KEY?.trim();
  return raw ? decodeKey(raw) : null;
}
