use keyring::Entry;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const SERVICE: &str = "me.grok.skuffen";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

fn fallback_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("credentials");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

fn fallback_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    Ok(fallback_dir(app)?.join(format!("{key}.secret")))
}

pub fn get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    match entry(key).and_then(|e| e.get_password().map_err(|err| err.to_string())) {
        Ok(value) => Ok(Some(value)),
        Err(_) => {
            let path = fallback_path(app, key)?;
            if !path.exists() {
                return Ok(None);
            }
            fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
        }
    }
}

pub fn set(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
    if entry(key)
        .and_then(|e| e.set_password(value).map_err(|err| err.to_string()))
        .is_ok()
    {
        return Ok(());
    }
    let path = fallback_path(app, key)?;
    fs::write(&path, value).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn backend(app: &tauri::AppHandle, key: &str) -> &'static str {
    if entry(key)
        .and_then(|e| e.get_password().map_err(|err| err.to_string()))
        .is_ok()
    {
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
    let _ = entry(key).and_then(|e| e.delete_credential().map_err(|err| err.to_string()));
    let path = fallback_path(app, key)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
