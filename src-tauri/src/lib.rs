mod crypto;
mod oauth;
mod secrets;
mod store;
mod vault;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use vault::VaultState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub bundle_root: Option<String>,
    pub preferred_provider: Option<String>,
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
fn copy_file_into_bundle(
    vault: State<VaultState>,
    root: String,
    source: String,
    dest: String,
) -> Result<(), String> {
    vault::import_file(&vault, &root, &source, &dest)
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
fn grok_oauth_login(app: tauri::AppHandle) -> Result<oauth::OAuthStatus, String> {
    oauth::login(&app)
}

#[tauri::command]
fn grok_oauth_status(app: tauri::AppHandle) -> Result<oauth::OAuthStatus, String> {
    oauth::status(&app)
}

#[tauri::command]
fn grok_oauth_logout(app: tauri::AppHandle) -> Result<(), String> {
    oauth::logout(&app)
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
            ensure_bundle,
            list_files,
            read_text,
            write_text,
            copy_file_into_bundle,
            unlock_vault,
            lock_vault,
            vault_status,
            export_plain_okf,
            secret_get,
            secret_set,
            secret_delete,
            grok_oauth_login,
            grok_oauth_status,
            grok_oauth_logout
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
