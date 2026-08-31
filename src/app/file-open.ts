/**
 * Open a person-card file from local OKF bytes.
 * Never http(s) — that would fetch or leak the people-graph.
 */
import { localPhotoBundlePath } from "./list-photo";

export function localDocumentBundlePath(resource?: string | null): string | null {
  return localPhotoBundlePath(resource);
}

export function localFileMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt") return "text/plain";
  if (ext === "md") return "text/markdown";
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  if (ext === "csv") return "text/csv";
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

export function localFileName(resource?: string | null, fallback = "file"): string {
  const path = localDocumentBundlePath(resource);
  const name = path?.split("/").pop()?.trim();
  return name || fallback;
}

/** Object URL from local bytes. Caller must revoke. Never remote. */
export function localFileObjectUrl(bytes: Uint8Array, path: string): string | null {
  if (!bytes.byteLength) return null;
  if (typeof URL === "undefined" || typeof Blob === "undefined") return null;
  const blob = new Blob([Uint8Array.from(bytes)], { type: localFileMime(path) });
  const url = URL.createObjectURL(blob);
  if (/^https?:/i.test(url)) {
    URL.revokeObjectURL(url);
    return null;
  }
  return url;
}
