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

    pub fn lock(&self) {
        if let Some(mut key) = self.key.lock().expect("vault lock").take() {
            for byte in &mut key {
                *byte = 0;
            }
        }
    }

    pub fn key(&self) -> Result<[u8; 32], String> {
        self.key
            .lock()
            .expect("vault lock")
            .ok_or_else(|| {
                "People-graph is locked. Unlock with your OS credentials.".to_string()
            })
    }

    pub fn is_unlocked(&self) -> bool {
        self.key.lock().expect("vault lock").is_some()
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

pub fn load_or_create_key(app: &tauri::AppHandle) -> Result<[u8; 32], String> {
    if let Some(existing) = secrets::get(app, VAULT_KEY_ID)? {
        return crypto::decode_key(&existing);
    }
    let key = crypto::generate_key();
    secrets::set(app, VAULT_KEY_ID, &crypto::encode_key(&key))?;
    Ok(key)
}

pub fn unlock(app: &tauri::AppHandle, vault: &VaultState) -> Result<VaultStatus, String> {
    let key = load_or_create_key(app)?;
    vault.set_key(key);
    Ok(status(app, vault)?)
}

pub fn lock(app: &tauri::AppHandle, vault: &VaultState) -> Result<VaultStatus, String> {
    vault.lock();
    Ok(status(app, vault)?)
}

pub fn status(app: &tauri::AppHandle, vault: &VaultState) -> Result<VaultStatus, String> {
    let root = current_root(app)?;
    let encrypted = bundle_is_encrypted(&root);
    let backend = secrets::backend(app, VAULT_KEY_ID);
    let unlocked = vault.is_unlocked();
    let message = Some(status_message(unlocked, encrypted, &backend));
    Ok(VaultStatus {
        available: true,
        unlocked,
        encrypted,
        key_backend: backend.to_string(),
        message,
    })
}

fn status_message(unlocked: bool, encrypted: bool, backend: &str) -> String {
    let key_where = match backend {
        "os-keychain" => {
            "The wrapping key is in the OS credential store (service me.grok.skuffen, account okf-master-key)."
        }
        "file-fallback" => {
            "No OS keychain was available; the wrapping key uses the same 0600 credentials-file fallback as provider tokens."
        }
        _ => "Unlock stores a wrapping key in the OS credential store (service me.grok.skuffen).",
    };
    if !unlocked {
        return format!(
            "The people-graph is locked. Unlock with your OS credentials. {key_where} There is no Skuffen account and no cloud KMS."
        );
    }
    if encrypted {
        format!("People-graph markdown, YAML, and photos are encrypted on disk (AES-256-GCM). {key_where}")
    } else {
        format!("Vault is unlocked. Existing plaintext files will be sealed on the next write. {key_where}")
    }
}

fn current_root(app: &tauri::AppHandle) -> Result<String, String> {
    let settings = store::load_settings(app).unwrap_or_else(|_| Settings::default());
    match settings.bundle_root.filter(|s| !s.trim().is_empty()) {
        Some(root) => Ok(root),
        None => store::default_bundle_path(app),
    }
}

fn bundle_is_encrypted(root: &str) -> bool {
    let meta = PathBuf::from(root).join(VAULT_META_NAME);
    if meta.exists() {
        return true;
    }
    store::list_files(root, None)
        .ok()
        .and_then(|files| {
            files.into_iter().find_map(|rel| {
                store::read_bytes(root, &rel)
                    .ok()
                    .flatten()
                    .map(|bytes| crypto::is_encrypted(&bytes))
            })
        })
        .unwrap_or(false)
}

pub fn ensure_bundle(
    app: &tauri::AppHandle,
    vault: &VaultState,
    root: Option<String>,
) -> Result<String, String> {
    let key = vault.key()?;
    let path = store::ensure_bundle_dirs(app, root)?;
    for (rel, contents) in store::missing_seeds(&path)? {
        write_bytes(vault, &path, &rel, contents.as_bytes())?;
    }
    seal_bundle(&path, &key)?;
    write_vault_meta(&path)?;
    Ok(path)
}

pub fn read_text(vault: &VaultState, root: &str, path: &str) -> Result<Option<String>, String> {
    let Some(bytes) = read_bytes(vault, root, path)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn write_text(vault: &VaultState, root: &str, path: &str, contents: &str) -> Result<(), String> {
    write_bytes(vault, root, path, contents.as_bytes())
}

pub fn read_bytes(vault: &VaultState, root: &str, path: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(raw) = store::read_bytes(root, path)? else {
        return Ok(None);
    };
    if crypto::is_encrypted(&raw) {
        let key = vault.key()?;
        return Ok(Some(crypto::decrypt(&key, path, &raw)?));
    }
    Ok(Some(raw))
}

pub fn write_bytes(vault: &VaultState, root: &str, path: &str, contents: &[u8]) -> Result<(), String> {
    if path == VAULT_META_NAME {
        return Err("Cannot overwrite vault metadata as an OKF document".into());
    }
    let key = vault.key()?;
    let sealed = crypto::encrypt(&key, path, contents)?;
    store::write_bytes(root, path, &sealed)?;
    write_vault_meta(root)?;
    Ok(())
}

pub fn import_file(vault: &VaultState, root: &str, source: &str, dest: &str) -> Result<(), String> {
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    write_bytes(vault, root, dest, &bytes)
}

pub fn export_plain(vault: &VaultState, root: &str, dest: &str) -> Result<(), String> {
    let key = vault.key()?;
    let dest_path = PathBuf::from(dest);
    let root_path = PathBuf::from(root);
    if dest_path == root_path || dest_path.starts_with(&root_path) {
        return Err("Export folder must be outside the encrypted bundle".into());
    }
    fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
    for rel in store::list_files(root, None)? {
        if rel == VAULT_META_NAME || rel.ends_with(".skuffen-tmp") {
            continue;
        }
        let Some(plain) = read_bytes(vault, root, &rel)? else {
            continue;
        };
        let abs = dest_path.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(abs, plain).map_err(|e| e.to_string())?;
    }
    let _ = key;
    Ok(())
}

fn seal_bundle(root: &str, key: &[u8; 32]) -> Result<usize, String> {
    let mut sealed = 0;
    for rel in store::list_files(root, None)? {
        if rel == VAULT_META_NAME || rel.ends_with(".skuffen-tmp") {
            continue;
        }
        let Some(raw) = store::read_bytes(root, &rel)? else {
            continue;
        };
        if crypto::is_encrypted(&raw) {
            continue;
        }
        let out = crypto::encrypt(key, &rel, &raw)?;
        store::write_bytes(root, &rel, &out)?;
        sealed += 1;
    }
    Ok(sealed)
}

fn write_vault_meta(root: &str) -> Result<(), String> {
    let dir = Path::new(root);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let meta = serde_json::json!({
        "format": "skuffen-okf-vault",
        "version": 1,
        "cipher": "aes-256-gcm",
        "keyId": VAULT_KEY_ID,
        "encrypted": true
    });
    fs::write(
        dir.join(VAULT_META_NAME),
        format!("{}\n", serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?),
    )
    .map_err(|e| e.to_string())
}
