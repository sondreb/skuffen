use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

const USER_AGENT: &str = concat!(
    "Skuffen/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/sondreb/skuffen)"
);
const LATEST_URL: &str = "https://api.github.com/repos/sondreb/skuffen/releases/latest";
const LIST_URL: &str = "https://api.github.com/repos/sondreb/skuffen/releases?per_page=20";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub app_image: bool,
}

pub fn runtime_info() -> DesktopRuntimeInfo {
    DesktopRuntimeInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: normalize_os(std::env::consts::OS),
        arch: normalize_arch(std::env::consts::ARCH),
        app_image: std::env::var_os("APPIMAGE").is_some(),
    }
}

fn normalize_os(os: &str) -> String {
    match os {
        "macos" | "ios" => "macos".into(),
        "windows" => "windows".into(),
        _ => "linux".into(),
    }
}

fn normalize_arch(arch: &str) -> String {
    match arch {
        "x86_64" | "amd64" => "x86_64".into(),
        "aarch64" | "arm64" => "aarch64".into(),
        "x86" | "i686" => "x86".into(),
        other => other.into(),
    }
}

fn github_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())
}

fn is_published(value: &serde_json::Value) -> bool {
    let draft = value.get("draft").and_then(|v| v.as_bool()).unwrap_or(false);
    let pre = value
        .get("prerelease")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    !draft && !pre && (value.get("tag_name").is_some() || value.get("name").is_some())
}

pub fn fetch_published_release() -> Result<Option<serde_json::Value>, String> {
    let client = github_client()?;
    let latest = client
        .get(LATEST_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?;
    if latest.status() == reqwest::StatusCode::NOT_FOUND {
        return fetch_from_list(&client);
    }
    if !latest.status().is_success() {
        return Err(format!(
            "GitHub releases failed: {}",
            latest.status()
        ));
    }
    let body: serde_json::Value = latest.json().map_err(|e| e.to_string())?;
    if is_published(&body) {
        return Ok(Some(body));
    }
    fetch_from_list(&client)
}

fn fetch_from_list(client: &reqwest::blocking::Client) -> Result<Option<serde_json::Value>, String> {
    let list = client
        .get(LIST_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?;
    if !list.status().is_success() {
        return Err(format!("GitHub releases list failed: {}", list.status()));
    }
    let body: serde_json::Value = list.json().map_err(|e| e.to_string())?;
    let Some(items) = body.as_array() else {
        return Ok(None);
    };
    Ok(items.iter().find(|item| is_published(item)).cloned())
}

fn allowed_download_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" {
        return Err("Installer URL must be https".into());
    }
    let host = parsed.host_str().unwrap_or_default();
    let ok = match host {
        "github.com" => parsed
            .path()
            .starts_with("/sondreb/skuffen/releases/download/"),
        "objects.githubusercontent.com"
        | "release-assets.githubusercontent.com"
        | "github-releases.githubusercontent.com" => true,
        _ => false,
    };
    if !ok {
        return Err("Installer URL is not a GitHub Release asset".into());
    }
    Ok(parsed)
}

fn safe_file_name(name: &str) -> Result<String, String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim();
    if base.is_empty() || base.contains('\0') {
        return Err("Invalid installer file name".into());
    }
    Ok(base.to_string())
}

fn download_to_temp(url: &str, file_name: &str) -> Result<PathBuf, String> {
    let parsed = allowed_download_url(url)?;
    let safe = safe_file_name(file_name)?;
    let dir = std::env::temp_dir().join("skuffen-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&safe);
    let client = github_client()?;
    let mut response = client
        .get(parsed)
        .header("Accept", "application/octet-stream")
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }
    let mut file = fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    response.copy_to(&mut bytes).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    Ok(dest)
}

pub fn download_and_run(app: &tauri::AppHandle, url: String, file_name: String) -> Result<(), String> {
    let dest = download_to_temp(&url, &file_name)?;
    let name = dest
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    #[cfg(target_os = "windows")]
    {
        run_windows(&dest, &name)?;
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        run_macos(&dest, &name)?;
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        run_linux(&dest, &name)?;
        app.exit(0);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn run_windows(path: &Path, name: &str) -> Result<(), String> {
    let mut cmd = if name.ends_with(".msi") {
        let mut c = Command::new("msiexec");
        c.arg("/i").arg(path).arg("/passive").arg("/norestart");
        c
    } else {
        let mut c = Command::new(path);
        c.arg("/P").arg("/UPDATE").arg("/R");
        c
    };
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn run_macos(path: &Path, name: &str) -> Result<(), String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let dest_app = macos_app_bundle(&current)
        .unwrap_or_else(|| PathBuf::from("/Applications/Skuffen.app"));
    if name.ends_with(".dmg") {
        let mount = attach_dmg(path)?;
        let src = find_app(&mount).ok_or_else(|| "DMG has no .app".to_string())?;
        spawn_replace_and_relaunch(&src, &dest_app, true)?;
        return Ok(());
    }
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        let unpack = path.parent().unwrap_or(Path::new(".")).join("skuffen-unpacked");
        let _ = fs::remove_dir_all(&unpack);
        fs::create_dir_all(&unpack).map_err(|e| e.to_string())?;
        let status = Command::new("tar")
            .args(["-xzf"])
            .arg(path)
            .arg("-C")
            .arg(&unpack)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not extract the macOS archive".into());
        }
        let src = find_app(&unpack).ok_or_else(|| "Archive has no .app".to_string())?;
        spawn_replace_and_relaunch(&src, &dest_app, true)?;
        return Ok(());
    }
    Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn run_linux(path: &Path, name: &str) -> Result<(), String> {
    if name.ends_with(".appimage") {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
        }
        let dest = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|dir| dir.join(path.file_name().unwrap_or_default())))
                    .unwrap_or_else(|| path.to_path_buf())
            });
        spawn_replace_and_relaunch(path, &dest, false)?;
        return Ok(());
    }
    if name.ends_with(".deb") {
        let status = Command::new("pkexec")
            .args(["dpkg", "-i"])
            .arg(path)
            .status();
        match status {
            Ok(code) if code.success() => {
                let _ = Command::new("skuffen").spawn();
                return Ok(());
            }
            _ => {
                Command::new("xdg-open")
                    .arg(path)
                    .spawn()
                    .map_err(|e| format!("Could not open the .deb installer: {e}"))?;
                return Ok(());
            }
        }
    }
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_app_bundle(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()?.to_str()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()?.to_str()? != "Contents" {
        return None;
    }
    contents.parent().map(|p| p.to_path_buf())
}

#[cfg(target_os = "macos")]
fn attach_dmg(path: &Path) -> Result<PathBuf, String> {
    let output = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly"])
        .arg(path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .rev()
        .find_map(|line| {
            line.split('\t')
                .last()
                .or_else(|| line.split_whitespace().last())
                .map(str::trim)
                .filter(|part| part.starts_with("/Volumes/"))
                .map(PathBuf::from)
        })
        .ok_or_else(|| "Could not mount the disk image".into())
}

#[cfg(target_os = "macos")]
fn find_app(root: &Path) -> Option<PathBuf> {
    if root.extension().and_then(|s| s.to_str()) == Some("app") {
        return Some(root.to_path_buf());
    }
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("app") {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_app(&path) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(unix)]
fn spawn_replace_and_relaunch(src: &Path, dest: &Path, is_app: bool) -> Result<(), String> {
    let pid = std::process::id();
    let src_s = src.to_string_lossy().replace('\'', "'\\''");
    let dest_s = dest.to_string_lossy().replace('\'', "'\\''");
    let script = if is_app {
        format!(
            "pid={pid}; src='{src_s}'; dest='{dest_s}'; \
             while kill -0 \"$pid\" 2>/dev/null; do sleep 0.2; done; \
             if [ -d \"$dest\" ]; then rm -rf \"$dest\"; fi; \
             if command -v ditto >/dev/null 2>&1; then ditto \"$src\" \"$dest\"; else cp -R \"$src\" \"$dest\"; fi; \
             open \"$dest\" 2>/dev/null || true"
        )
    } else {
        format!(
            "pid={pid}; src='{src_s}'; dest='{dest_s}'; \
             while kill -0 \"$pid\" 2>/dev/null; do sleep 0.2; done; \
             mkdir -p \"$(dirname \"$dest\")\"; \
             mv \"$src\" \"$dest\"; chmod +x \"$dest\"; \
             exec \"$dest\""
        )
    };
    Command::new("sh")
        .arg("-c")
        .arg(script)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

