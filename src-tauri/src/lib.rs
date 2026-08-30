mod crypto;
mod oauth;
mod secrets;
mod store;
mod update;
mod vault;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use vault::VaultState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FollowRecord {
    pub slug: String,
    pub interval: String,
    pub enabled: bool,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub bundle_root: Option<String>,
    pub preferred_provider: Option<String>,
    /// Local follow schedule + pending proposals. Not OKF. Never stores tokens.
    #[serde(default)]
    pub follows: Option<Vec<FollowRecord>>,
    #[serde(default)]
    pub proposals: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub dismissed_merges: Option<Vec<String>>,
    /// Inspectable log of what the model was told. Not OKF. Never stores tokens.
    #[serde(default)]
    pub memory_log: Option<Vec<serde_json::Value>>,
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    store::load_settings(&app)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    store::save_settings(&app, &settings)
}

#[tauri::command]
fn default_bundle_root(app: tauri::AppHandle) -> Result<String, String> {
    store::default_bundle_path(&app)
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Skuffen people-graph folder")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_image_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Add photo")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_document_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Add document")
        .add_filter(
            "Documents",
            &[
                "pdf", "png", "jpg", "jpeg", "webp", "gif", "txt", "md", "doc", "docx", "odt",
            ],
        )
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn ensure_bundle(
    app: tauri::AppHandle,
    vault: State<VaultState>,
    root: Option<String>,
) -> Result<String, String> {
    vault::ensure_bundle(&app, &vault, root)
}

#[tauri::command]
fn list_files(root: String, prefix: Option<String>) -> Result<Vec<String>, String> {
    store::list_files(&root, prefix.as_deref())
}

#[tauri::command]
fn read_text(
    vault: State<VaultState>,
    root: String,
    path: String,
) -> Result<Option<String>, String> {
    vault::read_text(&vault, &root, &path)
}

#[tauri::command]
fn write_text(
    vault: State<VaultState>,
    root: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    vault::write_text(&vault, &root, &path, &contents)
}

#[tauri::command]
fn delete_file(root: String, path: String) -> Result<(), String> {
    vault::delete_file(&root, &path)
}

#[tauri::command]
fn copy_file_into_bundle(
    vault: State<VaultState>,
    root: String,
    source: String,
    dest: String,
) -> Result<(), String> {
    vault::import_file(&vault, &root, &source, &dest)
}

#[tauri::command]
fn write_bytes(
    vault: State<VaultState>,
    root: String,
    path: String,
    contents: Vec<u8>,
) -> Result<(), String> {
    vault::write_bytes(&vault, &root, &path, &contents)
}

#[tauri::command]
fn read_bytes(
    vault: State<VaultState>,
    root: String,
    path: String,
) -> Result<Option<Vec<u8>>, String> {
    vault::read_bytes(&vault, &root, &path)
}

#[tauri::command]
fn unlock_vault(app: tauri::AppHandle, vault: State<VaultState>) -> Result<vault::VaultStatus, String> {
    vault::unlock(&app, &vault)
}

#[tauri::command]
fn lock_vault(app: tauri::AppHandle, vault: State<VaultState>) -> Result<vault::VaultStatus, String> {
    vault::lock(&app, &vault)
}

#[tauri::command]
fn vault_status(app: tauri::AppHandle, vault: State<VaultState>) -> Result<vault::VaultStatus, String> {
    vault::status(&app, &vault)
}

#[tauri::command]
fn export_plain_okf(
    vault: State<VaultState>,
    root: String,
) -> Result<Option<String>, String> {
    let dest = rfd::FileDialog::new()
        .set_title("Export plaintext OKF (this folder will be readable)")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string());
    let Some(dest) = dest else {
        return Ok(None);
    };
    vault::export_plain(&vault, &root, &dest)?;
    Ok(Some(dest))
}

#[tauri::command]
fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    secrets::get(&app, &key)
}

#[tauri::command]
fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    secrets::set(&app, &key, &value)
}

#[tauri::command]
fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    secrets::delete(&app, &key)
}

#[tauri::command]
fn fetch_public_bytes(url: String) -> Result<Option<Vec<u8>>, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Ok(None);
    }
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(4))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = match client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "image/*,*/*;q=0.8")
        .send()
    {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if !response.status().is_success() {
        return Ok(None);
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type.is_empty()
        && !content_type.starts_with("image/")
        && !content_type.starts_with("application/octet-stream")
    {
        return Ok(None);
    }
    let bytes = match response.bytes() {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Ok(None);
    }
    Ok(Some(bytes.to_vec()))
}

#[tauri::command]
fn grok_oauth_begin(app: tauri::AppHandle) -> Result<oauth::DevicePending, String> {
    oauth::begin(&app)
}

#[tauri::command]
fn grok_oauth_wait(app: tauri::AppHandle) -> Result<oauth::OAuthStatus, String> {
    oauth::wait(&app)
}

#[tauri::command]
fn grok_oauth_status(app: tauri::AppHandle) -> Result<oauth::OAuthStatus, String> {
    oauth::status(&app)
}

#[tauri::command]
fn grok_oauth_logout(app: tauri::AppHandle) -> Result<(), String> {
    oauth::logout(&app)
}

#[tauri::command]
fn desktop_runtime_info() -> update::DesktopRuntimeInfo {
    update::runtime_info()
}

#[tauri::command]
fn github_published_release() -> Result<Option<serde_json::Value>, String> {
    update::fetch_published_release()
}

#[tauri::command]
fn download_and_run_installer(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<(), String> {
    update::download_and_run(&app, url, file_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::new())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            default_bundle_root,
            pick_folder,
            pick_image_file,
            pick_document_file,
            ensure_bundle,
            list_files,
            read_text,
            write_text,
            delete_file,
            write_bytes,
            read_bytes,
            copy_file_into_bundle,
            unlock_vault,
            lock_vault,
            vault_status,
            export_plain_okf,
            secret_get,
            secret_set,
            secret_delete,
            fetch_public_bytes,
            grok_oauth_begin,
            grok_oauth_wait,
            grok_oauth_status,
            grok_oauth_logout,
            desktop_runtime_info,
            github_published_release,
            download_and_run_installer
        ])
        .setup(|app| {
            let _ = app.path().app_data_dir().map(|dir| {
                let _ = std::fs::create_dir_all(dir);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Skuffen");
}
