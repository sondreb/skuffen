import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IDENTITY_TRANSFORM,
  PREVIEW_MAX_SCALE,
  PREVIEW_MIN_SCALE,
  clampPreviewScale,
  panPreview,
  previewImageSrc,
  stepPreviewZoom,
  wheelPreviewZoom,
  zoomPreview,
} from "./image-preview.ts";

test("preview src is local data or blob — never http(s) graph photos", () => {
  const data = "data:image/png;base64,aa";
  const blob = "blob:http://localhost/ada";
  assert.equal(previewImageSrc(data), data);
  assert.equal(previewImageSrc(blob), blob);
  assert.equal(previewImageSrc("https://cdn.example/ada.jpg"), null);
  assert.equal(previewImageSrc("http://imgen.x.ai/tmp/ada.png"), null);
  assert.equal(previewImageSrc("/people/ada-demo/photos/portrait.png"), null);
  assert.equal(previewImageSrc("javascript:alert(1)"), null);
});

test("zoom clamps and resets pan at 1×", () => {
  assert.equal(clampPreviewScale(0.2), PREVIEW_MIN_SCALE);
  assert.equal(clampPreviewScale(99), PREVIEW_MAX_SCALE);
  const zoomed = zoomPreview(IDENTITY_TRANSFORM, 2, 100, 80);
  assert.equal(zoomed.scale, 2);
  assert.deepEqual(zoomPreview(zoomed, 0.5, 100, 80), IDENTITY_TRANSFORM);
});

test("wheel and controls zoom toward the cursor; pan only when zoomed", () => {
  const inAt = wheelPreviewZoom(IDENTITY_TRANSFORM, -40, 200, 120);
  assert.ok(inAt.scale > 1);
  const outAt = wheelPreviewZoom(inAt, 40, 200, 120);
  assert.ok(outAt.scale < inAt.scale);
  const stepped = stepPreviewZoom(IDENTITY_TRANSFORM, 1, 10, 10);
  assert.ok(stepped.scale > 1);
  assert.deepEqual(panPreview(IDENTITY_TRANSFORM, 40, -20), IDENTITY_TRANSFORM);
  const panned = panPreview(stepped, 12, -8);
  assert.equal(panned.x, stepped.x + 12);
  assert.equal(panned.y, stepped.y - 8);
});
