use crate::Settings;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use walkdir::WalkDir;

const SETTINGS_FILE: &str = "settings.json";

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
}

pub fn default_bundle_path(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(app_data_dir(app)?
        .join("people-graph")
        .to_string_lossy()
        .to_string())
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SETTINGS_FILE))
}

pub fn load_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_settings(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(app)?, raw).map_err(|e| e.to_string())
}

pub fn ensure_bundle_dirs(app: &tauri::AppHandle, root: Option<String>) -> Result<String, String> {
    let path = match root.filter(|s| !s.trim().is_empty()) {
        Some(p) => p,
        None => default_bundle_path(app)?,
    };
    fs::create_dir_all(PathBuf::from(&path).join("people")).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn missing_seeds(root: &str) -> Result<Vec<(String, String)>, String> {
    let mut seeds = Vec::new();
    let index = safe_join(root, "index.md")?;
    if !index.exists() {
        seeds.push((
            "index.md".into(),
            "---\nokf_version: \"0.2\"\n---\n\n# Skuffen\n\nLocal personal intelligence. The people-graph lives on this machine as an Open Knowledge Format v0.2 bundle.\n\n# People\n\n*Empty — add a person in Skuffen. Data stays on disk.*\n".into(),
        ));
    }
    let log = safe_join(root, "log.md")?;
    if !log.exists() {
        let today = chrono::Utc::now().format("%Y-%m-%d");
        seeds.push((
            "log.md".into(),
            format!(
                "# Directory Update Log\n\n## {today}\n* **Initialization**: Created Skuffen OKF v0.2 people-graph bundle.\n"
            ),
        ));
    }
    let people_index = safe_join(root, "people/index.md")?;
    if !people_index.exists() {
        seeds.push(("people/index.md".into(), "# People\n\n*No people yet.*\n".into()));
    }
    Ok(seeds)
}

fn safe_join(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(root));
    let cleaned = rel.replace('\\', "/");
    if cleaned.split('/').any(|part| part == "..") {
        return Err("path escapes bundle".into());
    }
    Ok(root_path.join(cleaned))
}

pub fn list_files(root: &str, prefix: Option<&str>) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(root);
    if !root_path.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in WalkDir::new(&root_path).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(&root_path)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if rel == ".skuffen-vault.json" || rel.ends_with(".skuffen-tmp") {
            continue;
        }
        if let Some(prefix) = prefix {
            if !rel.starts_with(prefix) {
                continue;
            }
        }
        out.push(rel);
    }
    out.sort();
    Ok(out)
}

pub fn read_bytes(root: &str, path: &str) -> Result<Option<Vec<u8>>, String> {
    let abs = safe_join(root, path)?;
    if !abs.exists() {
        return Ok(None);
    }
    fs::read(abs).map(Some).map_err(|e| e.to_string())
}

pub fn write_bytes(root: &str, path: &str, contents: &[u8]) -> Result<(), String> {
    let abs = safe_join(root, path)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = abs.with_file_name(format!(
        "{}.skuffen-tmp",
        abs.file_name().unwrap_or_default().to_string_lossy()
    ));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &abs).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn read_text(root: &str, path: &str) -> Result<Option<String>, String> {
    let Some(bytes) = read_bytes(root, path)? else {
        return Ok(None);
    };
    String::from_utf8(bytes).map(Some).map_err(|e| e.to_string())
}

pub fn write_text(root: &str, path: &str, contents: &str) -> Result<(), String> {
    write_bytes(root, path, contents.as_bytes())
}

pub fn copy_file(root: &str, source: &str, dest: &str) -> Result<(), String> {
    let dest_abs = safe_join(root, dest)?;
    if let Some(parent) = dest_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(Path::new(source), dest_abs).map_err(|e| e.to_string())?;
    Ok(())
}
