import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IDENTITY_TRANSFORM,
  PREVIEW_MAX_SCALE,
  PREVIEW_MIN_SCALE,
  clampPreviewScale,
  panPreview,
  previewImageSrc,
  previewLayoutCenter,
  previewOriginFromPointer,
  previewScreenPoint,
  stepPreviewZoom,
  wheelPreviewZoom,
  wheelPreviewZoomAtPointer,
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

test("wheel zoom toward a non-center point keeps that point under the cursor", () => {
  const rect = { left: 200, top: 80, width: 400, height: 300 };
  const clientX = 240;
  const clientY = 140;
  const origin = previewOriginFromPointer(clientX, clientY, IDENTITY_TRANSFORM, rect);
  assert.ok(origin.x < 0);
  assert.ok(origin.y < 0);

  const centerZoom = wheelPreviewZoomAtPointer(IDENTITY_TRANSFORM, -40, 400, 230, rect);
  assert.equal(centerZoom.x, 0);
  assert.equal(centerZoom.y, 0);
  assert.ok(centerZoom.scale > 1);

  const layout = previewLayoutCenter(IDENTITY_TRANSFORM, rect);
  const localX = clientX - layout.x;
  const localY = clientY - layout.y;
  const before = previewScreenPoint(IDENTITY_TRANSFORM, localX, localY, layout);
  assert.equal(before.x, clientX);
  assert.equal(before.y, clientY);

  let current = IDENTITY_TRANSFORM;
  let box = rect;
  for (let i = 0; i < 4; i++) {
    const next = wheelPreviewZoomAtPointer(current, -80, clientX, clientY, box);
    const mapped = previewScreenPoint(next, localX, localY, layout);
    assert.ok(Math.abs(mapped.x - clientX) < 1e-9, `zoom ${i} x drifted`);
    assert.ok(Math.abs(mapped.y - clientY) < 1e-9, `zoom ${i} y drifted`);
    assert.ok(next.x > 0, "zoom in on the left shifts the image right");
    box = {
      left: layout.x + next.x - (rect.width * next.scale) / 2,
      top: layout.y + next.y - (rect.height * next.scale) / 2,
      width: rect.width * next.scale,
      height: rect.height * next.scale,
    };
    current = next;
  }

  const out = wheelPreviewZoomAtPointer(current, 80, clientX, clientY, box);
  const outMapped = previewScreenPoint(out, localX, localY, layout);
  assert.ok(Math.abs(outMapped.x - clientX) < 1e-9);
  assert.ok(Math.abs(outMapped.y - clientY) < 1e-9);
});

test("raw viewport client coords are not the zoom origin", () => {
  const rect = { left: 200, top: 80, width: 400, height: 300 };
  const clientX = 240;
  const clientY = 140;
  const layout = previewLayoutCenter(IDENTITY_TRANSFORM, rect);
  const localX = clientX - layout.x;
  const localY = clientY - layout.y;
  const wrong = wheelPreviewZoom(IDENTITY_TRANSFORM, -40, clientX, clientY);
  const drifted = previewScreenPoint(wrong, localX, localY, layout);
  assert.ok(Math.abs(drifted.x - clientX) > 1);
});
