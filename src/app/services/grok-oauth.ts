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
}

export interface GrokOAuthStatus {
  connected: boolean;
  expiresAt?: number | null;
  tokenType?: string | null;
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
  return {
    connected: Boolean(rec.connected),
    expiresAt: typeof rec.expiresAt === "number" ? rec.expiresAt : null,
    tokenType: typeof rec.tokenType === "string" ? rec.tokenType : null,
  };
}

export function publicDevicePending(raw: unknown): GrokDevicePending {
  const rec = asRecord(raw);
  return {
    userCode: String(rec.userCode ?? ""),
    verificationUri: String(rec.verificationUri ?? ""),
    verificationUriComplete: typeof rec.verificationUriComplete === "string" ? rec.verificationUriComplete : null,
    expiresIn: typeof rec.expiresIn === "number" ? rec.expiresIn : 0,
  };
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
