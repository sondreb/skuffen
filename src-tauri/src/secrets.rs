use keyring::Entry;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const SERVICE: &str = "me.grok.skuffen";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

fn os_get(key: &str) -> Result<String, String> {
    entry(key).and_then(|e| e.get_password().map_err(|err| err.to_string()))
}

fn os_set(key: &str, value: &str) -> Result<(), String> {
    entry(key).and_then(|e| e.set_password(value).map_err(|err| err.to_string()))
}

fn os_delete(key: &str) -> Result<(), String> {
    entry(key).and_then(|e| e.delete_credential().map_err(|err| err.to_string()))
}

fn usable(value: &str) -> bool {
    !value.trim().is_empty()
}

fn fallback_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("credentials");
    ensure_secret_dir(&dir)?;
    Ok(dir)
}

fn fallback_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    Ok(fallback_dir(app)?.join(format!("{key}.secret")))
}

fn ensure_secret_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn write_secret_file(dir: &Path, key: &str, value: &str) -> Result<(), String> {
    ensure_secret_dir(dir)?;
    let path = dir.join(format!("{key}.secret"));
    fs::write(&path, value).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_secret_file(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let path = dir.join(format!("{key}.secret"));
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

fn delete_secret_file(dir: &Path, key: &str) -> Result<(), String> {
    let path = dir.join(format!("{key}.secret"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Persist `value` in the OS store when a later `get` can read the same bytes.
/// keyring 3 without a platform feature uses a per-Entry mock, so a bare
/// `set_password` success is not enough. If the OS store does not round-trip
/// (mock, Windows size limit, empty read), write the 0600 file fallback and
/// drop a shadowing OS value so `get` cannot miss what `set` wrote.
pub(crate) fn persist_secret(key: &str, value: &str, fallback_dir: &Path) -> Result<(), String> {
    let os_matches = os_set(key, value).is_ok() && os_get(key).ok().as_deref() == Some(value);
    if os_matches {
        return Ok(());
    }
    write_secret_file(fallback_dir, key, value)?;
    if let Ok(existing) = os_get(key) {
        if existing != value {
            let _ = os_delete(key);
        }
    }
    match load_secret(key, fallback_dir)? {
        Some(got) if got == value => Ok(()),
        _ => Err(
            "Could not persist the secret in the OS credential store (service me.grok.skuffen)."
                .into(),
        ),
    }
}

pub(crate) fn load_secret(key: &str, fallback_dir: &Path) -> Result<Option<String>, String> {
    if let Ok(value) = os_get(key) {
        if usable(&value) {
            return Ok(Some(value));
        }
    }
    read_secret_file(fallback_dir, key)
}

pub(crate) fn remove_secret(key: &str, fallback_dir: &Path) -> Result<(), String> {
    let _ = os_delete(key);
    delete_secret_file(fallback_dir, key)
}

pub fn get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    load_secret(key, &fallback_dir(app)?)
}

pub fn set(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
    persist_secret(key, value, &fallback_dir(app)?)
}

pub fn backend(app: &tauri::AppHandle, key: &str) -> &'static str {
    if os_get(key).ok().filter(|value| usable(value)).is_some() {
        return "os-keychain";
    }
    if fallback_path(app, key)
        .map(|path| path.exists())
        .unwrap_or(false)
    {
        return "file-fallback";
    }
    "none"
}

pub fn delete(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    remove_secret(key, &fallback_dir(app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skuffen-secrets-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn service_stays_skuffen_identifier() {
        assert_eq!(SERVICE, "me.grok.skuffen");
    }

    #[test]
    fn file_fallback_round_trips_jwt_sized_oauth_json() {
        let dir = tmp("large");
        // Synthetic size only. Not a real token. Windows Credential Manager
        // historically caps blobs around 2560 bytes; fallback must still work.
        let access = format!("sk-test-{}", "a".repeat(1800));
        let refresh = format!("rt-test-{}", "b".repeat(1800));
        let value = format!(
            r#"{{"access_token":"{access}","refresh_token":"{refresh}","token_type":"Bearer"}}"#
        );
        assert!(value.len() > 2560);
        persist_secret("grok_oauth", &value, &dir).unwrap();
        let got = load_secret("grok_oauth", &dir).unwrap();
        assert_eq!(got.as_deref(), Some(value.as_str()));
        remove_secret("grok_oauth", &dir).unwrap();
        assert_eq!(load_secret("grok_oauth", &dir).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_os_value_does_not_hide_fallback_file() {
        let dir = tmp("empty");
        write_secret_file(&dir, "grok_oauth", r#"{"access_token":"sk-test-fallback"}"#).unwrap();
        let got = load_secret("grok_oauth", &dir).unwrap();
        assert_eq!(
            got.as_deref(),
            Some(r#"{"access_token":"sk-test-fallback"}"#)
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
