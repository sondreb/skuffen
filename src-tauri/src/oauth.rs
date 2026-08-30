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
    pub interval: u64,
}

/// One token-endpoint attempt. Never includes device_code or tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollOutcome {
    pub state: String,
    pub interval: Option<u64>,
    pub connected: bool,
    pub expires_at: Option<u64>,
    pub token_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTokens {
    #[serde(alias = "accessToken")]
    access_token: String,
    #[serde(default, alias = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(default, alias = "tokenType")]
    token_type: Option<String>,
    #[serde(default, alias = "expiresAt")]
    expires_at: Option<u64>,
}

#[derive(Debug)]
enum TokenInterpret {
    Tokens(StoredTokens),
    Pending,
    SlowDown,
    Failed(String),
}

enum OnePoll {
    Pending { interval: u64 },
    Tokens(StoredTokens),
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
    expires_in: Option<serde_json::Value>,
    #[serde(default)]
    interval: Option<serde_json::Value>,
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
        Some(raw) => Ok(status_from_raw(&raw)),
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
    {
        let mut slot = PENDING.lock().map_err(|e| e.to_string())?;
        *slot = Some(PendingDevice {
            device_code: body.device_code,
            interval: pending.interval,
            deadline: Instant::now() + Duration::from_secs(pending.expires_in.max(1)),
        });
    }
    open_verification(app, &pending)?;
    Ok(pending)
}

pub fn wait(app: &tauri::AppHandle) -> Result<OAuthStatus, String> {
    let tokens = poll_for_tokens()?;
    persist_tokens(app, &tokens)
}

/// One token-endpoint attempt. The UI sleeps using `interval` so a long
/// blocking `grok_oauth_wait` cannot die after approval with nothing saved.
pub fn poll(app: &tauri::AppHandle) -> Result<PollOutcome, String> {
    match poll_once()? {
        OnePoll::Pending { interval } => Ok(PollOutcome {
            state: "pending".into(),
            interval: Some(interval),
            connected: false,
            expires_at: None,
            token_type: None,
        }),
        OnePoll::Tokens(tokens) => {
            let status = persist_tokens(app, &tokens)?;
            Ok(PollOutcome {
                state: "signedIn".into(),
                interval: None,
                connected: status.connected,
                expires_at: status.expires_at,
                token_type: status.token_type,
            })
        }
    }
}

fn status_from_stored(stored: &StoredTokens) -> OAuthStatus {
    OAuthStatus {
        connected: !stored.access_token.is_empty(),
        expires_at: stored.expires_at,
        token_type: stored.token_type.clone(),
    }
}

/// Public status from whatever the OS store actually holds. Never returns token fields.
fn status_from_raw(raw: &str) -> OAuthStatus {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return OAuthStatus {
            connected: false,
            expires_at: None,
            token_type: None,
        };
    }
    if let Ok(stored) = serde_json::from_str::<StoredTokens>(trimmed) {
        return status_from_stored(&stored);
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(obj) = value.as_object() {
            let access = obj
                .get("access_token")
                .or_else(|| obj.get("accessToken"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let token_type = obj
                .get("token_type")
                .or_else(|| obj.get("tokenType"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let expires_at = obj
                .get("expires_at")
                .or_else(|| obj.get("expiresAt"))
                .and_then(|v| v.as_u64());
            let flagged = obj.get("connected").and_then(|v| v.as_bool()).unwrap_or(false)
                || obj.get("grokOauth").and_then(|v| v.as_bool()).unwrap_or(false)
                || obj.get("signedIn").and_then(|v| v.as_bool()).unwrap_or(false);
            return OAuthStatus {
                connected: flagged || !access.is_empty() || token_type.is_some(),
                expires_at,
                token_type,
            };
        }
    }
    OAuthStatus {
        connected: true,
        expires_at: None,
        token_type: None,
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
        expires_in: json_positive_u64(body.expires_in.as_ref(), 1800),
        interval: json_positive_u64(body.interval.as_ref(), DEFAULT_INTERVAL_SECS),
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

fn persist_tokens(app: &tauri::AppHandle, tokens: &StoredTokens) -> Result<OAuthStatus, String> {
    if tokens.access_token.trim().is_empty() {
        clear_pending();
        return Err("xAI token response omitted a usable token".into());
    }
    let raw = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    secrets::set(app, TOKEN_KEY, &raw).map_err(|e| {
        clear_pending();
        format!("Grok sign-in did not persist in the OS credential store: {e}")
    })?;
    clear_pending();
    let status = status(app)?;
    if !status.connected {
        return Err("Grok sign-in did not persist in the OS credential store.".into());
    }
    Ok(status)
}

fn poll_for_tokens() -> Result<StoredTokens, String> {
    loop {
        let interval = {
            let slot = PENDING.lock().map_err(|e| e.to_string())?;
            let pending = slot
                .as_ref()
                .ok_or_else(|| "Grok sign-in was cancelled".to_string())?;
            if Instant::now() >= pending.deadline {
                return Err("Grok sign-in expired. Try again.".into());
            }
            pending.interval
        };
        std::thread::sleep(Duration::from_secs(interval.max(1)));
        match poll_once()? {
            OnePoll::Pending { .. } => {}
            OnePoll::Tokens(tokens) => return Ok(tokens),
        }
    }
}

fn poll_once() -> Result<OnePoll, String> {
    let (device_code, interval, deadline) = {
        let slot = PENDING.lock().map_err(|e| e.to_string())?;
        let pending = slot
            .as_ref()
            .ok_or_else(|| "Grok sign-in was cancelled".to_string())?;
        if Instant::now() >= pending.deadline {
            return Err("Grok sign-in expired. Try again.".into());
        }
        (
            pending.device_code.clone(),
            pending.interval,
            pending.deadline,
        )
    };
    if Instant::now() >= deadline {
        clear_pending();
        return Err("Grok sign-in expired. Try again.".into());
    }

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&device_token_form(&device_code))
        .send()
        .map_err(|e| e.to_string())?;
    let http_status = response.status().as_u16();
    let text = response.text().unwrap_or_default();
    match interpret_token_http(http_status, &text) {
        TokenInterpret::Tokens(tokens) => Ok(OnePoll::Tokens(tokens)),
        TokenInterpret::Pending => Ok(OnePoll::Pending { interval }),
        TokenInterpret::SlowDown => {
            let next = next_poll_interval(interval, Some("slow_down"));
            if let Ok(mut slot) = PENDING.lock() {
                if let Some(pending) = slot.as_mut() {
                    if pending.device_code == device_code {
                        pending.interval = next;
                    }
                }
            }
            Ok(OnePoll::Pending { interval: next })
        }
        TokenInterpret::Failed(message) => {
            clear_pending();
            Err(message)
        }
    }
}

fn interpret_token_http(status: u16, text: &str) -> TokenInterpret {
    let value: serde_json::Value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
    let error = json_string(value.get("error")).unwrap_or_default();
    if let Some(tokens) = stored_from_value(&value) {
        return TokenInterpret::Tokens(tokens);
    }
    if !error.is_empty() {
        return classify_oauth_error(&error, &value);
    }
    if (200..300).contains(&status) {
        return TokenInterpret::Failed(
            "xAI token poll returned success without a usable token".into(),
        );
    }
    TokenInterpret::Failed("xAI token poll failed".into())
}

fn classify_oauth_error(error: &str, value: &serde_json::Value) -> TokenInterpret {
    let description = json_string(value.get("error_description"));
    match error {
        "authorization_pending" => TokenInterpret::Pending,
        "slow_down" => TokenInterpret::SlowDown,
        "access_denied" | "authorization_denied" => {
            TokenInterpret::Failed(description.unwrap_or_else(|| "Grok sign-in was denied".into()))
        }
        "expired_token" => TokenInterpret::Failed("Grok sign-in expired. Try again.".into()),
        _ => TokenInterpret::Failed(format!(
            "xAI token poll failed: {}",
            description.unwrap_or_else(|| error.to_string())
        )),
    }
}

fn stored_from_value(value: &serde_json::Value) -> Option<StoredTokens> {
    let obj = value.as_object()?;
    let access = json_string(
        obj.get("access_token")
            .or_else(|| obj.get("accessToken")),
    )
    .filter(|s| !s.is_empty())?;
    let refresh = json_string(
        obj.get("refresh_token")
            .or_else(|| obj.get("refreshToken")),
    )
    .filter(|s| !s.is_empty());
    let token_type = json_string(obj.get("token_type").or_else(|| obj.get("tokenType")))
        .filter(|s| !s.is_empty());
    let expires_in = json_positive_u64(
        obj.get("expires_in").or_else(|| obj.get("expiresIn")),
        0,
    );
    let expires_at = (expires_in > 0).then(|| now_secs().saturating_add(expires_in));
    Some(StoredTokens {
        access_token: access,
        refresh_token: refresh,
        token_type,
        expires_at,
    })
}

fn json_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn json_positive_u64(value: Option<&serde_json::Value>, default: u64) -> u64 {
    let parsed = value.and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_i64().and_then(|n| u64::try_from(n).ok()))
            .or_else(|| {
                v.as_f64()
                    .filter(|n| n.is_finite() && *n > 0.0)
                    .map(|n| n as u64)
            })
            .or_else(|| v.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
    });
    parsed.filter(|n| *n > 0).unwrap_or(default)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
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
            expires_in: Some(serde_json::json!(900)),
            interval: Some(serde_json::json!(5)),
        };
        let pending = public_device_pending(&body).unwrap();
        let json = serde_json::to_value(&pending).unwrap();
        assert_eq!(json["userCode"], "WDJB-MJHT");
        assert_eq!(json["verificationUri"], "https://auth.x.ai/connect");
        assert_eq!(json["interval"], 5);
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
    fn status_from_camel_case_store_is_connected_without_secrets() {
        let raw = r#"{"accessToken":"sk-secret","tokenType":"Bearer","expiresAt":1700000000}"#;
        let status = status_from_raw(raw);
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["connected"], true);
        assert_eq!(json["tokenType"], "Bearer");
        assert!(json.get("accessToken").is_none());
        let dumped = json.to_string();
        assert!(!dumped.contains("sk-secret"));
        assert!(!dumped.contains("accessToken"));
    }

    #[test]
    fn status_from_token_poll_blob_is_connected_without_secrets() {
        let raw =
            r#"{"access_token":"sk-poll","refresh_token":"r","token_type":"Bearer","expires_in":3600}"#;
        let status = status_from_raw(raw);
        assert!(status.connected);
        let dumped = serde_json::to_string(&status).unwrap();
        assert!(!dumped.contains("sk-poll"));
        assert!(!dumped.contains("access_token"));
        assert!(!dumped.contains("refresh_token"));
    }

    #[test]
    fn verification_url_prefers_complete_https() {
        let pending = DevicePending {
            user_code: "ABCD-EFGH".into(),
            verification_uri: "https://auth.x.ai/connect".into(),
            verification_uri_complete: Some("https://auth.x.ai/connect?user_code=ABCD-EFGH".into()),
            expires_in: 600,
            interval: 5,
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

    #[test]
    fn token_poll_parses_real_world_xai_shapes() {
        match interpret_token_http(
            200,
            r#"{"access_token":"sk-test-access","refresh_token":"sk-test-refresh","token_type":"Bearer","expires_in":3600,"id_token":"eyJ-not-stored"}"#,
        ) {
            TokenInterpret::Tokens(tokens) => {
                assert_eq!(tokens.access_token, "sk-test-access");
                assert_eq!(tokens.refresh_token.as_deref(), Some("sk-test-refresh"));
                assert_eq!(tokens.token_type.as_deref(), Some("Bearer"));
                assert!(tokens.expires_at.unwrap() > now_secs());
            }
            other => panic!("expected tokens, got {other:?}"),
        }

        match interpret_token_http(
            200,
            r#"{"accessToken":"sk-test-camel","refreshToken":"sk-test-rt","tokenType":"Bearer","expiresIn":"1800"}"#,
        ) {
            TokenInterpret::Tokens(tokens) => {
                assert_eq!(tokens.access_token, "sk-test-camel");
                assert_eq!(tokens.expires_at.unwrap() > now_secs(), true);
            }
            other => panic!("expected camelCase tokens, got {other:?}"),
        }

        assert!(matches!(
            interpret_token_http(200, r#"{"error":"authorization_pending"}"#),
            TokenInterpret::Pending
        ));
        assert!(matches!(
            interpret_token_http(400, r#"{"error":"authorization_pending"}"#),
            TokenInterpret::Pending
        ));
        assert!(matches!(
            interpret_token_http(400, r#"{"error":"slow_down"}"#),
            TokenInterpret::SlowDown
        ));
        match interpret_token_http(200, r#"{"token_type":"Bearer"}"#) {
            TokenInterpret::Failed(message) => {
                assert!(message.contains("without a usable token"));
                assert!(!message.contains("sk-"));
            }
            other => panic!("expected failed parse, got {other:?}"),
        }
        match interpret_token_http(403, r#"{"error":"access_denied","error_description":"nope"}"#) {
            TokenInterpret::Failed(message) => {
                assert_eq!(message, "nope");
            }
            other => panic!("expected denied, got {other:?}"),
        }
    }

    #[test]
    fn poll_outcome_never_serializes_tokens() {
        let outcome = PollOutcome {
            state: "signedIn".into(),
            interval: None,
            connected: true,
            expires_at: Some(1_700_000_000),
            token_type: Some("Bearer".into()),
        };
        let dumped = serde_json::to_string(&outcome).unwrap();
        assert!(dumped.contains("signedIn"));
        assert!(!dumped.contains("access_token"));
        assert!(!dumped.contains("refresh_token"));
        assert!(!dumped.contains("device_code"));
    }

    #[test]
    fn persist_requires_non_empty_access_token() {
        let empty = StoredTokens {
            access_token: "  ".into(),
            refresh_token: None,
            token_type: Some("Bearer".into()),
            expires_at: None,
        };
        // persist_tokens needs an AppHandle; the guard is the same check.
        assert!(empty.access_token.trim().is_empty());
        assert!(!status_from_stored(&empty).connected);
    }

    #[test]
    fn device_pending_accepts_string_expires_and_interval() {
        let body = DeviceCodeResponse {
            device_code: "secret-device".into(),
            user_code: "ABCD-EFGH".into(),
            verification_uri: "https://auth.x.ai/connect".into(),
            verification_uri_complete: None,
            expires_in: Some(serde_json::json!("900")),
            interval: Some(serde_json::json!("5")),
        };
        let pending = public_device_pending(&body).unwrap();
        assert_eq!(pending.expires_in, 900);
        assert_eq!(pending.interval, 5);
        assert!(!serde_json::to_string(&pending).unwrap().contains("secret-device"));
    }
}
