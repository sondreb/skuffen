/**
 * People-list avatars stay on this machine.
 * Never return http(s) — the sidebar would fetch every row and leak the graph.
 * Proposal-sheet previews use photoPreviewUrl (Accept-time, one URL). Not this.
 */

const LOCAL_DISPLAY = /^(data:image\/[a-z0-9.+-]+;base64,|blob:)/i;
const REMOTE = /^(https?:|\/\/)/i;

export function personListPhotoUrl(resource?: string | null): string | null {
  const value = resource?.trim() ?? "";
  if (!value || REMOTE.test(value) || /^javascript:/i.test(value)) return null;
  return LOCAL_DISPLAY.test(value) ? value : null;
}

/** Bundle-relative photo path from OKF resource. Null for remote or script URLs. */
export function localPhotoBundlePath(resource?: string | null): string | null {
  const value = resource?.trim() ?? "";
  if (!value || REMOTE.test(value) || /^(data:|blob:|javascript:)/i.test(value)) return null;
  const path = value.replace(/^\//, "");
  if (!path || path.includes("://")) return null;
  return path;
}

export function localPhotoDataUrl(bytes: Uint8Array, path: string): string | null {
  if (!bytes.byteLength) return null;
  const mime = photoMimeFromPath(path);
  if (!mime) return null;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function photoMimeFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
