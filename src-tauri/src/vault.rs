use crate::crypto;
use crate::secrets;
use crate::store;
use crate::Settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const VAULT_KEY_ID: &str = "okf-master-key";
pub const VAULT_META_NAME: &str = ".skuffen-vault.json";

pub struct VaultState {
    key: Mutex<Option<[u8; 32]>>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            key: Mutex::new(None),
        }
    }

    pub fn set_key(&self, key: [u8; 32]) {
        *self.key.lock().expect("vault lock") = Some(key);
    }

    pub fn peek_key(&self) -> Option<[u8; 32]> {
        *self.key.lock().expect("vault lock")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub available: bool,
    pub unlocked: bool,
    pub encrypted: bool,
    pub key_backend: String,
    pub message: Option<String>,
}

pub struct OpenedFile {
    pub bytes: Vec<u8>,
    pub was_ciphertext: bool,
}

/// Open on-disk bytes. Leftover SKUF1 ciphertext is decrypted in memory only.
/// Callers rewrite plaintext after a successful decrypt. Missing/wrong keys
/// return an error and must not write back.
pub fn open_file_bytes(
    raw: &[u8],
    rel_path: &str,
    key: Option<&[u8; 32]>,
) -> Result<OpenedFile, String> {
    if !crypto::is_encrypted(raw) {
        return Ok(OpenedFile {
            bytes: raw.to_vec(),
            was_ciphertext: false,
        });
    }
    let Some(key) = key else {
        return Err(leftover_error(
            rel_path,
            "The wrapping key is missing from the OS credential store (service me.grok.skuffen, account okf-master-key).",
        ));
    };
    match crypto::decrypt(key, rel_path, raw) {
        Ok(plain) => Ok(OpenedFile {
            bytes: plain,
            was_ciphertext: true,
        }),
        Err(_) => Err(leftover_error(
            rel_path,
            "Wrong key, or the file was moved.",
        )),
    }
}

fn leftover_error(rel_path: &str, reason: &str) -> String {
    format!("Could not decrypt {rel_path}. {reason} The leftover ciphertext was not changed.")
}

/// Load a leftover wrapping key if one already exists. Never create a new key.
pub fn load_existing_key(app: &tauri::AppHandle, vault: &VaultState) -> Result<Option<[u8; 32]>, String> {
    if let Some(key) = vault.peek_key() {
        return Ok(Some(key));
    }
    match secrets::get(app, VAULT_KEY_ID)? {
        Some(existing) => {
            let key = crypto::decode_key(&existing)?;
            vault.set_key(key);
            Ok(Some(key))
        }
        None => Ok(None),
    }
}

pub fn unlock(app: &tauri::AppHandle, vault: &VaultState) -> Result<VaultStatus, String> {
    let _ = load_existing_key(app, vault)?;
    let root = current_root(app)?;
    let _ = unseal_leftover(app, vault, &root);
    Ok(status(app, vault)?)
}

pub fn lock(app: &tauri::AppHandle, vault: &VaultState) -> Result<VaultStatus, String> {
    let _ = vault;
    Ok(status(app, vault)?)
}

pub fn status(app: &tauri::AppHandle, vault: &VaultState) -> Result<VaultStatus, String> {
    let root = current_root(app)?;
    let leftover = leftover_ciphertext(&root);
    let backend = secrets::backend(app, VAULT_KEY_ID);
    let _ = vault;
    Ok(VaultStatus {
        available: true,
        unlocked: true,
        encrypted: leftover,
        key_backend: backend.to_string(),
        message: Some(status_message(leftover, &backend)),
    })
}

fn status_message(leftover: bool, backend: &str) -> String {
    let tokens = "Grok/Gemini tokens stay in the OS credential store (service me.grok.skuffen). There is no cloud KMS and no people-graph upload.";
    if leftover {
        let key_where = match backend {
            "os-keychain" | "file-fallback" => {
                "A leftover wrapping key is in the OS credential store (account okf-master-key)."
            }
            _ => {
                "Leftover ciphertext needs the wrapping key from the OS credential store (service me.grok.skuffen, account okf-master-key)."
            }
        };
        format!(
            "Leftover AES-256-GCM ciphertext is still on disk. Skuffen rewrites those files as plaintext when the wrapping key can decrypt them. Files that cannot be decrypted are left unchanged. {key_where} {tokens}"
        )
    } else {
        format!("People-graph is plaintext markdown+YAML on disk. {tokens}")
    }
}

fn current_root(app: &tauri::AppHandle) -> Result<String, String> {
    let settings = store::load_settings(app).unwrap_or_else(|_| Settings::default());
    match settings.bundle_root.filter(|s| !s.trim().is_empty()) {
        Some(root) => Ok(root),
        None => store::default_bundle_path(app),
    }
}

fn leftover_ciphertext(root: &str) -> bool {
    store::list_files(root, None)
        .ok()
        .map(|files| {
            files.into_iter().any(|rel| {
                store::read_bytes(root, &rel)
                    .ok()
                    .flatten()
                    .map(|bytes| crypto::is_encrypted(&bytes))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

pub fn ensure_bundle(
    app: &tauri::AppHandle,
    vault: &VaultState,
    root: Option<String>,
) -> Result<String, String> {
    let path = store::ensure_bundle_dirs(app, root)?;
    for (rel, contents) in store::missing_seeds(&path)? {
        write_bytes(&path, &rel, contents.as_bytes())?;
    }
    let _ = unseal_leftover(app, vault, &path);
    Ok(path)
}

pub fn read_text(
    app: &tauri::AppHandle,
    vault: &VaultState,
    root: &str,
    path: &str,
) -> Result<Option<String>, String> {
    let Some(bytes) = read_bytes(app, vault, root, path)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn write_text(root: &str, path: &str, contents: &str) -> Result<(), String> {
    write_bytes(root, path, contents.as_bytes())
}

pub fn delete_file(root: &str, path: &str) -> Result<(), String> {
    if path == VAULT_META_NAME {
        return Err("Cannot delete vault metadata as an OKF document".into());
    }
    store::delete_file(root, path)
}

pub fn read_bytes(
    app: &tauri::AppHandle,
    vault: &VaultState,
    root: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, String> {
    let Some(raw) = store::read_bytes(root, path)? else {
        return Ok(None);
    };
    let key = load_existing_key(app, vault)?;
    let opened = open_file_bytes(&raw, path, key.as_ref())?;
    if opened.was_ciphertext {
        store::write_bytes(root, path, &opened.bytes)?;
        maybe_remove_vault_meta(root);
    }
    Ok(Some(opened.bytes))
}

pub fn write_bytes(root: &str, path: &str, contents: &[u8]) -> Result<(), String> {
    if path == VAULT_META_NAME {
        return Err("Cannot overwrite vault metadata as an OKF document".into());
    }
    store::write_bytes(root, path, contents)
}

pub fn import_file(root: &str, source: &str, dest: &str) -> Result<(), String> {
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    write_bytes(root, dest, &bytes)
}

pub fn export_plain(
    app: &tauri::AppHandle,
    vault: &VaultState,
    root: &str,
    dest: &str,
) -> Result<(), String> {
    let dest_path = PathBuf::from(dest);
    let root_path = PathBuf::from(root);
    if dest_path == root_path || dest_path.starts_with(&root_path) {
        return Err("Export folder must be outside the people-graph bundle".into());
    }
    fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
    for rel in store::list_files(root, None)? {
        if rel == VAULT_META_NAME || rel.ends_with(".skuffen-tmp") {
            continue;
        }
        let Some(plain) = read_bytes(app, vault, root, &rel)? else {
            continue;
        };
        let abs = dest_path.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(abs, plain).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn unseal_leftover(app: &tauri::AppHandle, vault: &VaultState, root: &str) -> Result<usize, String> {
    let key = load_existing_key(app, vault)?;
    let mut rewritten = 0;
    for rel in store::list_files(root, None)? {
        if rel == VAULT_META_NAME || rel.ends_with(".skuffen-tmp") {
            continue;
        }
        let Some(raw) = store::read_bytes(root, &rel)? else {
            continue;
        };
        if !crypto::is_encrypted(&raw) {
            continue;
        }
        match open_file_bytes(&raw, &rel, key.as_ref()) {
            Ok(opened) => {
                store::write_bytes(root, &rel, &opened.bytes)?;
                rewritten += 1;
            }
            Err(_) => {
                // Leave this file unchanged. A later read surfaces the error.
            }
        }
    }
    maybe_remove_vault_meta(root);
    Ok(rewritten)
}

fn maybe_remove_vault_meta(root: &str) {
    if leftover_ciphertext(root) {
        return;
    }
    let meta = Path::new(root).join(VAULT_META_NAME);
    if meta.exists() {
        let _ = fs::remove_file(meta);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaintext_round_trip_is_unchanged() {
        let raw = b"---\ntype: Person\ntitle: Ada Lovelace\n---\n";
        let opened = open_file_bytes(raw, "people/ada/person.md", None).unwrap();
        assert!(!opened.was_ciphertext);
        assert_eq!(opened.bytes, raw);
    }

    #[test]
    fn leftover_ciphertext_decrypts_in_memory() {
        let key = crypto::generate_key();
        let path = "log.md";
        let plain = b"# Directory Update Log\n";
        let sealed = crypto::encrypt(&key, path, plain).unwrap();
        let opened = open_file_bytes(&sealed, path, Some(&key)).unwrap();
        assert!(opened.was_ciphertext);
        assert_eq!(opened.bytes, plain);
        assert!(crypto::is_encrypted(&sealed));
    }

    #[test]
    fn missing_key_does_not_claim_success() {
        let key = crypto::generate_key();
        let path = "log.md";
        let sealed = crypto::encrypt(&key, path, b"secret").unwrap();
        let err = open_file_bytes(&sealed, path, None).unwrap_err();
        assert!(err.contains("Could not decrypt log.md"));
        assert!(err.contains("okf-master-key"));
        assert!(err.contains("was not changed"));
    }

    #[test]
    fn wrong_key_does_not_claim_success() {
        let key = crypto::generate_key();
        let other = crypto::generate_key();
        let path = "log.md";
        let sealed = crypto::encrypt(&key, path, b"secret").unwrap();
        let before = sealed.clone();
        let err = open_file_bytes(&sealed, path, Some(&other)).unwrap_err();
        assert!(err.contains("Could not decrypt log.md"));
        assert!(err.contains("Wrong key"));
        assert!(err.contains("was not changed"));
        assert_eq!(sealed, before);
    }
}
