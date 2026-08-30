/**
 * Full-card image preview. Local data/blob only — never http(s) graph photos.
 */
import { personListPhotoUrl } from "./list-photo";

export const PREVIEW_MIN_SCALE = 1;
export const PREVIEW_MAX_SCALE = 6;
export const PREVIEW_ZOOM_STEP = 0.35;
export const PREVIEW_WHEEL_FACTOR = 1.12;

export type PreviewTransform = {
  scale: number;
  x: number;
  y: number;
};

export type ImagePreview = {
  src: string;
  title?: string;
  /** True only when this is the opened profile's profile photo. */
  diorama?: boolean;
};

export const IDENTITY_TRANSFORM: PreviewTransform = { scale: 1, x: 0, y: 0 };

export function previewImageSrc(src?: string | null): string | null {
  return personListPhotoUrl(src);
}

export function clampPreviewScale(scale: number): number {
  if (!Number.isFinite(scale)) return PREVIEW_MIN_SCALE;
  return Math.min(PREVIEW_MAX_SCALE, Math.max(PREVIEW_MIN_SCALE, scale));
}

export function zoomPreview(
  current: PreviewTransform,
  nextScale: number,
  originX: number,
  originY: number,
): PreviewTransform {
  const scale = clampPreviewScale(nextScale);
  if (scale <= PREVIEW_MIN_SCALE) return IDENTITY_TRANSFORM;
  if (scale === current.scale) return current;
  const ratio = scale / current.scale;
  return {
    scale,
    x: originX - (originX - current.x) * ratio,
    y: originY - (originY - current.y) * ratio,
  };
}

export function panPreview(current: PreviewTransform, dx: number, dy: number): PreviewTransform {
  if (current.scale <= PREVIEW_MIN_SCALE) return current;
  if (!dx && !dy) return current;
  return { scale: current.scale, x: current.x + dx, y: current.y + dy };
}

export function stepPreviewZoom(
  current: PreviewTransform,
  direction: 1 | -1,
  originX: number,
  originY: number,
): PreviewTransform {
  return zoomPreview(current, current.scale + direction * PREVIEW_ZOOM_STEP, originX, originY);
}

export function wheelPreviewZoom(
  current: PreviewTransform,
  deltaY: number,
  originX: number,
  originY: number,
): PreviewTransform {
  const factor = deltaY < 0 ? PREVIEW_WHEEL_FACTOR : 1 / PREVIEW_WHEEL_FACTOR;
  return zoomPreview(current, current.scale * factor, originX, originY);
}

export function pointerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointerMidpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
