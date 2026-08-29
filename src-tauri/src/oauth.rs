use crate::secrets;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::mpsc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_opener::OpenerExt;

/// Public Grok CLI client. xAI does not offer third-party app registration;
/// loopback PKCE against this allowlisted client is the viable official OIDC path.
const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const AUTHORIZE_URL: &str = "https://auth.x.ai/oauth2/authorize";
const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
const REDIRECT_URI: &str = "http://127.0.0.1:56121/callback";
const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
const TOKEN_KEY: &str = "grok_oauth";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    pub connected: bool,
    pub expires_at: Option<u64>,
    pub token_type: Option<String>,
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

pub fn status(app: &tauri::AppHandle) -> Result<OAuthStatus, String> {
    match secrets::get(app, TOKEN_KEY)? {
        Some(raw) => {
            let stored: StoredTokens = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(OAuthStatus {
                connected: !stored.access_token.is_empty(),
                expires_at: stored.expires_at,
                token_type: stored.token_type,
            })
        }
        None => Ok(OAuthStatus {
            connected: false,
            expires_at: None,
            token_type: None,
        }),
    }
}

pub fn logout(app: &tauri::AppHandle) -> Result<(), String> {
    secrets::delete(app, TOKEN_KEY)
}

pub fn login(app: &tauri::AppHandle) -> Result<OAuthStatus, String> {
    let verifier = random_urlsafe(32);
    let challenge = {
        let digest = Sha256::digest(verifier.as_bytes());
        URL_SAFE_NO_PAD.encode(digest)
    };
    let state = random_urlsafe(16);
    let mut url = url::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("plan", "generic")
        .append_pair("referrer", "skuffen");

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        if let Err(err) = wait_for_code(state, tx.clone()) {
            let _ = tx.send(Err(err));
        }
    });

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;

    let code = rx
        .recv_timeout(std::time::Duration::from_secs(180))
        .map_err(|_| "Grok sign-in timed out".to_string())??;
    let tokens = exchange_code(&code, &verifier)?;
    secrets::set(app, TOKEN_KEY, &serde_json::to_string(&tokens).map_err(|e| e.to_string())?)?;
    status(app)
}

fn wait_for_code(expected_state: String, tx: mpsc::Sender<Result<String, String>>) -> Result<(), String> {
    let server = tiny_http::Server::http("127.0.0.1:56121").map_err(|e| e.to_string())?;
    let request = server.recv().map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:56121{}", request.url());
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    let html = if pairs.get("state").map(String::as_str) != Some(expected_state.as_str()) {
        let _ = tx.send(Err("OAuth state mismatch".into()));
        "<html><body><p>Skuffen could not verify the sign-in. You can close this window.</p></body></html>"
    } else if let Some(code) = pairs.get("code") {
        let _ = tx.send(Ok(code.clone()));
        "<html><body style=\"font-family:sans-serif;background:#141210;color:#f3efe6\"><p>Signed in to Grok. Return to Skuffen.</p></body></html>"
    } else {
        let err = pairs
            .get("error_description")
            .or_else(|| pairs.get("error"))
            .cloned()
            .unwrap_or_else(|| "missing code".into());
        let _ = tx.send(Err(err));
        "<html><body><p>Sign-in failed. You can close this window.</p></body></html>"
    };
    let response = tiny_http::Response::from_string(html).with_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
            .unwrap(),
    );
    let _ = request.respond(response);
    Ok(())
}

fn exchange_code(code: &str, verifier: &str) -> Result<StoredTokens, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "xAI token exchange failed: {}",
            response.text().unwrap_or_default()
        ));
    }
    let body: TokenResponse = response.json().map_err(|e| e.to_string())?;
    let expires_at = body.expires_in.map(|secs| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + secs
    });
    Ok(StoredTokens {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        token_type: body.token_type,
        expires_at,
    })
}

fn random_urlsafe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}
