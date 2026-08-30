use crate::secrets;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri_plugin_opener::OpenerExt;

/// Public Grok CLI client. xAI does not offer third-party app registration.
/// Desktop sign-in uses RFC 8628 device authorization against this allowlisted client.
pub const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
pub const DEVICE_CODE_URL: &str = "https://auth.x.ai/oauth2/device/code";
pub const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
pub const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
pub const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
const TOKEN_KEY: &str = "grok_oauth";
const DEFAULT_INTERVAL_SECS: u64 = 5;
const SLOW_DOWN_SECS: u64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    pub connected: bool,
    pub expires_at: Option<u64>,
    pub token_type: Option<String>,
}

/// Fields the UI may show. Never includes device_code or tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePending {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTokens {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenErrorBody {
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    #[serde(default, alias = "verification_url")]
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    interval: Option<u64>,
}

struct PendingDevice {
    device_code: String,
    interval: u64,
    deadline: Instant,
}

static PENDING: Mutex<Option<PendingDevice>> = Mutex::new(None);

pub fn device_code_form() -> [(&'static str, &'static str); 2] {
    [("client_id", CLIENT_ID), ("scope", SCOPE)]
}

pub fn device_token_form<'a>(device_code: &'a str) -> [(&'a str, &'a str); 3] {
    [
        ("grant_type", DEVICE_GRANT),
        ("client_id", CLIENT_ID),
        ("device_code", device_code),
    ]
}

pub fn next_poll_interval(interval: u64, error: Option<&str>) -> u64 {
    if error == Some("slow_down") {
        interval.saturating_add(SLOW_DOWN_SECS)
    } else {
        interval.max(1)
    }
}

pub fn status(app: &tauri::AppHandle) -> Result<OAuthStatus, String> {
    match secrets::get(app, TOKEN_KEY)? {
        Some(raw) => {
            let stored: StoredTokens = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(status_from_stored(&stored))
        }
        None => Ok(OAuthStatus {
            connected: false,
            expires_at: None,
            token_type: None,
        }),
    }
}

pub fn logout(app: &tauri::AppHandle) -> Result<(), String> {
    clear_pending();
    secrets::delete(app, TOKEN_KEY)
}

pub fn begin(app: &tauri::AppHandle) -> Result<DevicePending, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(DEVICE_CODE_URL)
        .form(&device_code_form())
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "xAI device authorization failed: {}",
            response.text().unwrap_or_default()
        ));
    }
    let body: DeviceCodeResponse = response.json().map_err(|e| e.to_string())?;
    let pending = public_device_pending(&body)?;
    let interval = body.interval.unwrap_or(DEFAULT_INTERVAL_SECS).max(1);
    let expires_in = body.expires_in.unwrap_or(1800).max(1);
    {
        let mut slot = PENDING.lock().map_err(|e| e.to_string())?;
        *slot = Some(PendingDevice {
            device_code: body.device_code,
            interval,
            deadline: Instant::now() + Duration::from_secs(expires_in),
        });
    }
    open_verification(app, &pending)?;
    Ok(pending)
}

pub fn wait(app: &tauri::AppHandle) -> Result<OAuthStatus, String> {
    let tokens = poll_for_tokens()?;
    secrets::set(
        app,
        TOKEN_KEY,
        &serde_json::to_string(&tokens).map_err(|e| e.to_string())?,
    )?;
    clear_pending();
    status(app)
}

fn status_from_stored(stored: &StoredTokens) -> OAuthStatus {
    OAuthStatus {
        connected: !stored.access_token.is_empty(),
        expires_at: stored.expires_at,
        token_type: stored.token_type.clone(),
    }
}

fn public_device_pending(body: &DeviceCodeResponse) -> Result<DevicePending, String> {
    if body.user_code.trim().is_empty() {
        return Err("xAI device authorization omitted user_code".into());
    }
    let verification_uri = body.verification_uri.trim().to_string();
    let complete = body
        .verification_uri_complete
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if verification_uri.is_empty() && complete.is_none() {
        return Err("xAI device authorization omitted verification_uri".into());
    }
    Ok(DevicePending {
        user_code: body.user_code.trim().to_string(),
        verification_uri,
        verification_uri_complete: complete,
        expires_in: body.expires_in.unwrap_or(1800),
    })
}

fn open_verification(app: &tauri::AppHandle, pending: &DevicePending) -> Result<(), String> {
    let url = verification_open_url(pending)?;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn verification_open_url(pending: &DevicePending) -> Result<String, String> {
    let raw = pending
        .verification_uri_complete
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(pending.verification_uri.as_str());
    if !raw.starts_with("https://") {
        return Err("Untrusted verification URI in xAI device response".into());
    }
    Ok(raw.to_string())
}

fn poll_for_tokens() -> Result<StoredTokens, String> {
    let client = reqwest::blocking::Client::new();
    loop {
        let (device_code, mut interval, deadline) = {
            let slot = PENDING.lock().map_err(|e| e.to_string())?;
            let pending = slot.as_ref().ok_or_else(|| "Grok sign-in was cancelled".to_string())?;
            if Instant::now() >= pending.deadline {
                return Err("Grok sign-in expired. Try again.".into());
            }
            (
                pending.device_code.clone(),
                pending.interval,
                pending.deadline,
            )
        };

        std::thread::sleep(Duration::from_secs(interval));
        if Instant::now() >= deadline {
            clear_pending();
            return Err("Grok sign-in expired. Try again.".into());
        }

        let response = client
            .post(TOKEN_URL)
            .form(&device_token_form(&device_code))
            .send()
            .map_err(|e| e.to_string())?;
        let status = response.status();
        let text = response.text().unwrap_or_default();
        if status.is_success() {
            let body: TokenResponse = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            return Ok(stored_from_token(body));
        }

        let err_body: TokenErrorBody = serde_json::from_str(&text).unwrap_or(TokenErrorBody {
            error: None,
            error_description: Some(text.clone()),
        });
        let error = err_body.error.as_deref().unwrap_or("");
        match error {
            "authorization_pending" => {}
            "slow_down" => {
                interval = next_poll_interval(interval, Some("slow_down"));
                if let Ok(mut slot) = PENDING.lock() {
                    if let Some(pending) = slot.as_mut() {
                        if pending.device_code == device_code {
                            pending.interval = interval;
                        }
                    }
                }
            }
            "access_denied" | "authorization_denied" => {
                clear_pending();
                return Err(err_body
                    .error_description
                    .unwrap_or_else(|| "Grok sign-in was denied".into()));
            }
            "expired_token" => {
                clear_pending();
                return Err("Grok sign-in expired. Try again.".into());
            }
            _ => {
                clear_pending();
                return Err(format!(
                    "xAI token poll failed: {}",
                    err_body.error_description.unwrap_or(text)
                ));
            }
        }
    }
}

fn stored_from_token(body: TokenResponse) -> StoredTokens {
    let expires_at = body.expires_in.map(|secs| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + secs
    });
    StoredTokens {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        token_type: body.token_type,
        expires_at,
    }
}

fn clear_pending() {
    if let Ok(mut slot) = PENDING.lock() {
        *slot = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_code_request_is_public_client_and_scope() {
        let form = device_code_form();
        assert_eq!(form[0], ("client_id", CLIENT_ID));
        assert_eq!(form[1], ("scope", SCOPE));
        assert_eq!(CLIENT_ID, "b1a00492-073a-47ea-816f-4c329264a828");
        assert_eq!(DEVICE_CODE_URL, "https://auth.x.ai/oauth2/device/code");
        let joined = form
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&");
        assert!(!joined.contains("redirect_uri"));
        assert!(!joined.contains("code_challenge"));
        assert!(!joined.contains("127.0.0.1"));
    }

    #[test]
    fn token_poll_uses_device_code_grant() {
        let form = device_token_form("dev-abc");
        assert_eq!(form[0], ("grant_type", DEVICE_GRANT));
        assert_eq!(form[1], ("client_id", CLIENT_ID));
        assert_eq!(form[2], ("device_code", "dev-abc"));
        assert_eq!(DEVICE_GRANT, "urn:ietf:params:oauth:grant-type:device_code");
        assert_eq!(TOKEN_URL, "https://auth.x.ai/oauth2/token");
        assert_ne!(form[0].1, "authorization_code");
    }

    #[test]
    fn slow_down_increases_interval() {
        assert_eq!(next_poll_interval(5, None), 5);
        assert_eq!(next_poll_interval(5, Some("authorization_pending")), 5);
        assert_eq!(next_poll_interval(5, Some("slow_down")), 10);
        assert_eq!(next_poll_interval(10, Some("slow_down")), 15);
    }

    #[test]
    fn public_pending_never_includes_device_code_or_tokens() {
        let body = DeviceCodeResponse {
            device_code: "secret-device".into(),
            user_code: " WDJB-MJHT ".into(),
            verification_uri: "https://auth.x.ai/connect".into(),
            verification_uri_complete: Some("https://auth.x.ai/connect?user_code=WDJB-MJHT".into()),
            expires_in: Some(900),
            interval: Some(5),
        };
        let pending = public_device_pending(&body).unwrap();
        let json = serde_json::to_value(&pending).unwrap();
        assert_eq!(json["userCode"], "WDJB-MJHT");
        assert_eq!(json["verificationUri"], "https://auth.x.ai/connect");
        assert!(json.get("deviceCode").is_none());
        assert!(json.get("device_code").is_none());
        assert!(json.get("accessToken").is_none());
        assert!(json.get("access_token").is_none());
        assert!(json.get("refreshToken").is_none());
        let dumped = json.to_string();
        assert!(!dumped.contains("secret-device"));
        assert!(!dumped.contains("access_token"));
    }

    #[test]
    fn oauth_status_never_serializes_tokens() {
        let stored = StoredTokens {
            access_token: "sk-very-long-access-token".into(),
            refresh_token: Some("refresh-secret".into()),
            token_type: Some("Bearer".into()),
            expires_at: Some(1_700_000_000),
        };
        let status = status_from_stored(&stored);
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["connected"], true);
        assert_eq!(json["tokenType"], "Bearer");
        assert!(json.get("accessToken").is_none());
        assert!(json.get("access_token").is_none());
        assert!(json.get("refreshToken").is_none());
        let dumped = json.to_string();
        assert!(!dumped.contains("sk-very-long-access-token"));
        assert!(!dumped.contains("refresh-secret"));
    }

    #[test]
    fn verification_url_prefers_complete_https() {
        let pending = DevicePending {
            user_code: "ABCD-EFGH".into(),
            verification_uri: "https://auth.x.ai/connect".into(),
            verification_uri_complete: Some("https://auth.x.ai/connect?user_code=ABCD-EFGH".into()),
            expires_in: 600,
        };
        assert_eq!(
            verification_open_url(&pending).unwrap(),
            "https://auth.x.ai/connect?user_code=ABCD-EFGH"
        );
        let http = DevicePending {
            verification_uri_complete: Some("http://evil.example/steal".into()),
            ..pending.clone()
        };
        assert!(verification_open_url(&http).is_err());
    }
}
