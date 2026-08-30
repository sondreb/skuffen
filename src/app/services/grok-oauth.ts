/** Public Grok CLI client already allowlisted at auth.x.ai. No Skuffen cloud backend. */
export const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
export const GROK_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const GROK_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const GROK_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const GROK_OAUTH_SECRET_KEY = "grok_oauth";
export const GROK_API_KEY_SECRET_KEY = "grok_api_key";

export const BROWSER_OAUTH_ERROR =
  "Grok OAuth needs the Skuffen desktop shell. Use an API key in this browser preview.";

export interface GrokDevicePending {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  expiresIn: number;
  interval: number;
}

export interface GrokOAuthStatus {
  connected: boolean;
  expiresAt?: number | null;
  tokenType?: string | null;
}

export type GrokOAuthPollState = "pending" | "signedIn";

export interface GrokOAuthPoll extends GrokOAuthStatus {
  state: GrokOAuthPollState;
  interval?: number | null;
}

const SECRET_FIELD = /^(access_token|accessToken|refresh_token|refreshToken|device_code|deviceCode)$/;

export function deviceCodeRequestBody(): { client_id: string; scope: string } {
  return { client_id: GROK_OAUTH_CLIENT_ID, scope: GROK_OAUTH_SCOPE };
}

export function deviceTokenPollBody(deviceCode: string): {
  grant_type: string;
  client_id: string;
  device_code: string;
} {
  return {
    grant_type: GROK_DEVICE_GRANT,
    client_id: GROK_OAUTH_CLIENT_ID,
    device_code: deviceCode,
  };
}

export function nextPollInterval(intervalSecs: number, error?: string | null): number {
  if (error === "slow_down") return intervalSecs + 5;
  return Math.max(intervalSecs, 1);
}

export function grokConnectionLabel(status: { grokOauth: boolean; grokApiKey: boolean }): string {
  if (status.grokOauth) return "Signed in";
  if (status.grokApiKey) return "API key saved";
  return "Not connected";
}

export function publicOauthStatus(raw: unknown): GrokOAuthStatus {
  const rec = asRecord(raw);
  const tokenType = asOptionalString(rec["tokenType"] ?? rec["token_type"]);
  const expiresAt = asOptionalNumber(rec["expiresAt"] ?? rec["expires_at"]);
  // IPC may use camelCase, snake_case, or the stored token blob. Never copy secrets out.
  const connected =
    truthyFlag(rec["connected"]) ||
    truthyFlag(rec["grokOauth"]) ||
    truthyFlag(rec["signedIn"]) ||
    truthyFlag(rec["signed_in"]) ||
    Boolean(tokenType) ||
    nonEmptyString(rec["access_token"]) ||
    nonEmptyString(rec["accessToken"]);
  return {
    connected,
    expiresAt,
    tokenType,
  };
}

export function publicDevicePending(raw: unknown): GrokDevicePending {
  const rec = asRecord(raw);
  return {
    userCode: String(rec["userCode"] ?? rec["user_code"] ?? ""),
    verificationUri: String(rec["verificationUri"] ?? rec["verification_uri"] ?? ""),
    verificationUriComplete:
      typeof rec["verificationUriComplete"] === "string"
        ? rec["verificationUriComplete"]
        : typeof rec["verification_uri_complete"] === "string"
          ? rec["verification_uri_complete"]
          : null,
    expiresIn: asOptionalNumber(rec["expiresIn"] ?? rec["expires_in"]) ?? 0,
    interval: asOptionalNumber(rec["interval"]) ?? 5,
  };
}

export function publicOauthPoll(raw: unknown): GrokOAuthPoll {
  const rec = asRecord(raw);
  const status = publicOauthStatus(raw);
  const stateRaw = typeof rec["state"] === "string" ? rec["state"] : "";
  const state: GrokOAuthPollState =
    stateRaw === "signedIn" || status.connected ? "signedIn" : "pending";
  return {
    state,
    interval: asOptionalNumber(rec["interval"]),
    connected: status.connected,
    expiresAt: status.expiresAt,
    tokenType: status.tokenType,
  };
}

/** Tauri invoke rejects with Error, string, or `{ message }`. Never copy token bodies. */
export function invokeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return sanitizeError(error.message);
  if (typeof error === "string" && error.trim()) return sanitizeError(error);
  const rec = asRecord(error);
  if (typeof rec["message"] === "string" && rec["message"].trim()) {
    return sanitizeError(rec["message"]);
  }
  if (typeof rec["error"] === "string" && rec["error"].trim()) {
    return sanitizeError(rec["error"]);
  }
  return "Grok sign-in failed.";
}

function sanitizeError(message: string): string {
  if (
    SECRET_FIELD.test(message) ||
    /\b(access_token|accessToken|refresh_token|refreshToken|device_code|deviceCode)\b/.test(message) ||
    /sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}/.test(message)
  ) {
    return "Grok sign-in failed.";
  }
  return message;
}

/** True if an IPC/UI payload still carries tokens or the device_code secret. */
export function payloadHasSecretFields(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(payloadHasSecretFields);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) return true;
    if (payloadHasSecretFields(child)) return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
