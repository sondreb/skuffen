import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  decryptBytes,
  encryptBytes,
  EncryptedBundleError,
  isEncrypted,
  normalizeVaultPath,
  VAULT_META_NAME,
  vaultMetaDocument,
  type VaultMeta,
} from "./vault.ts";

export function safeJoin(root: string, rel: string): string {
  const cleaned = normalizeVaultPath(rel);
  if (!cleaned || cleaned.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("path escapes bundle");
  }
  return join(root, cleaned);
}

export function isVaultMetaPath(rel: string): boolean {
  return normalizeVaultPath(rel) === VAULT_META_NAME;
}

export function readVaultMeta(root: string): VaultMeta | null {
  const abs = join(root, VAULT_META_NAME);
  if (!existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(abs, "utf8")) as VaultMeta;
    if (parsed.format === "skuffen-okf-vault" && parsed.encrypted) return parsed;
  } catch {
    return null;
  }
  return null;
}

export function writeVaultMeta(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, VAULT_META_NAME), `${JSON.stringify(vaultMetaDocument(), null, 2)}\n`, "utf8");
}

export function listBundleFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
      } else if (!isVaultMetaPath(rel) && !name.endsWith(".skuffen-tmp")) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  out.sort();
  return out;
}

export function readBundleFile(root: string, rel: string, key: Uint8Array | null): Buffer | null {
  const abs = safeJoin(root, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  const raw = readFileSync(abs);
  if (isEncrypted(raw)) {
    if (!key) throw new EncryptedBundleError();
    return Buffer.from(decryptBytes(key, rel, raw));
  }
  return raw;
}

export function deleteBundleFile(root: string, rel: string): void {
  if (isVaultMetaPath(rel)) {
    throw new Error("Cannot delete vault metadata as an OKF document");
  }
  const abs = safeJoin(root, rel);
  if (existsSync(abs)) {
    rmSync(abs);
  }
}

export function writeBundleFile(root: string, rel: string, data: Uint8Array, key: Uint8Array | null): void {
  if (isVaultMetaPath(rel)) {
    throw new Error("Cannot overwrite vault metadata as an OKF document");
  }
  const abs = safeJoin(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (!key) {
    if (existsSync(abs) && isEncrypted(readFileSync(abs))) {
      throw new EncryptedBundleError();
    }
    writeFileSync(abs, data);
    return;
  }
  const sealed = encryptBytes(key, rel, data);
  atomicWrite(abs, sealed);
  writeVaultMeta(root);
}

export function sealBundle(root: string, key: Uint8Array): { sealed: number } {
  let sealed = 0;
  for (const rel of listBundleFiles(root)) {
    const abs = safeJoin(root, rel);
    const raw = readFileSync(abs);
    if (isEncrypted(raw)) continue;
    atomicWrite(abs, encryptBytes(key, rel, raw));
    sealed += 1;
  }
  writeVaultMeta(root);
  return { sealed };
}

export function exportPlainBundle(root: string, dest: string, key: Uint8Array): void {
  const destRoot = dest.replace(/[/\\]+$/, "");
  if (!destRoot || destRoot === root) {
    throw new Error("Export folder must be outside the encrypted bundle");
  }
  mkdirSync(destRoot, { recursive: true });
  for (const rel of listBundleFiles(root)) {
    const plain = readBundleFile(root, rel, key);
    if (!plain) continue;
    const abs = safeJoin(destRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, plain);
  }
}

function atomicWrite(abs: string, data: Uint8Array): void {
  const tmp = `${abs}.skuffen-tmp`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, abs);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}
