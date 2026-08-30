/**
 * Grok Imagine image-to-image for one local profile photo.
 * Never include the people-graph, notes, social, or sibling cards.
 */

export const IMAGINE_EDITS_URL = "https://api.x.ai/v1/images/edits";
export const IMAGINE_MODEL = "grok-imagine-image-2.0";
export const DIORAMA_PROMPT =
  "3D clay diorama of this person, same likeness, clay miniature / diorama look.";
export const DIORAMA_MENU_LABEL = "3D clay diorama";
export const DIORAMA_PHOTO_TITLE = "3D clay diorama";
export const DIORAMA_NEEDS_GROK = "Connect Grok in Menu → Providers first.";
export const DIORAMA_NEEDS_PHOTO = "Add a profile photo first.";
export const DIORAMA_PROGRESS = "Making 3D clay diorama…";

/** 1×1 teal PNG so ?demo=1 can finish offline. Not a real Imagine render. */
export const DEMO_DIORAMA_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/APwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (ch) => ch.charCodeAt(0),
);

export type ImagineEditResult =
  | { kind: "bytes"; bytes: Uint8Array; mime: string }
  | { kind: "url"; url: string };

export function grokImagineEditRequest(
  imageDataUrl: string,
  prompt = DIORAMA_PROMPT,
  model = IMAGINE_MODEL,
): { url: typeof IMAGINE_EDITS_URL; body: Record<string, unknown> } {
  if (!isLocalImageDataUrl(imageDataUrl)) {
    throw new Error("Imagine edits need a local image data URL, not a remote address.");
  }
  return {
    url: IMAGINE_EDITS_URL,
    body: {
      model,
      prompt,
      n: 1,
      response_format: "b64_json",
      image: {
        url: imageDataUrl,
        type: "image_url",
      },
    },
  };
}

export function imageBytesToDataUrl(bytes: Uint8Array, mime?: string): string {
  if (!bytes.byteLength) throw new Error("Profile photo is empty.");
  const type = mime || sniffImageMime(bytes) || "image/png";
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function parseImagineEditResponse(payload: unknown): ImagineEditResult {
  const root = asRecord(payload);
  const first = Array.isArray(root["data"]) ? asRecord(root["data"][0]) : asRecord(root["data"]);
  const b64 = firstString(first["b64_json"], first["b64Json"]);
  if (b64) {
    return { kind: "bytes", bytes: decodeBase64Image(b64), mime: mimeFromEncodedImage(b64) };
  }
  const url = firstString(first["url"]);
  if (url.startsWith("data:image/")) {
    return { kind: "bytes", bytes: decodeBase64Image(url), mime: mimeFromEncodedImage(url) };
  }
  if (/^https?:\/\//i.test(url)) {
    return { kind: "url", url };
  }
  throw new Error("Imagine did not return an image.");
}

export function decodeBase64Image(value: string): Uint8Array {
  const trimmed = value.trim();
  const comma = trimmed.indexOf(",");
  const raw = trimmed.startsWith("data:") && comma > 0 ? trimmed.slice(comma + 1) : trimmed;
  const binary = atob(raw);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  if (!out.byteLength) throw new Error("Imagine returned an empty image.");
  return out;
}

function mimeFromEncodedImage(value: string): string {
  const match = value.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  if (match) return match[1].toLowerCase();
  return sniffImageMime(decodeBase64Image(value)) ?? "image/png";
}

function isLocalImageDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim());
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
