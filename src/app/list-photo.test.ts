import assert from "node:assert/strict";
import { test } from "node:test";
import { localPhotoBundlePath, localPhotoDataUrl, personListPhotoUrl } from "./list-photo.ts";

test("people-list avatars never use http(s) — that would fetch the graph", () => {
  assert.equal(personListPhotoUrl("https://cdn.example/ada.jpg"), null);
  assert.equal(personListPhotoUrl("http://cdn.example/ada.jpg"), null);
  assert.equal(personListPhotoUrl("//cdn.example/ada.jpg"), null);
  assert.equal(personListPhotoUrl("javascript:alert(1)"), null);
  assert.equal(personListPhotoUrl("/people/ada-demo/photos/park.jpg"), null);
});

test("people-list avatars may use local data or blob URLs already on this machine", () => {
  const data = "data:image/png;base64,aa";
  const blob = "blob:http://localhost/ada";
  assert.equal(personListPhotoUrl(data), data);
  assert.equal(personListPhotoUrl(blob), blob);
  assert.equal(personListPhotoUrl("data:text/html;base64,aa"), null);
});

test("local OKF photo paths stay bundle-relative and never remote", () => {
  assert.equal(localPhotoBundlePath("/people/ada-demo/photos/park.jpg"), "people/ada-demo/photos/park.jpg");
  assert.equal(localPhotoBundlePath("people/ada-demo/photos/park.jpg"), "people/ada-demo/photos/park.jpg");
  assert.equal(localPhotoBundlePath("https://cdn.example/ada.jpg"), null);
  assert.equal(localPhotoBundlePath("http://cdn.example/ada.jpg"), null);
  assert.equal(localPhotoBundlePath("data:image/png;base64,aa"), null);
});

test("local photo bytes become a data URL — no host to fetch", () => {
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const url = localPhotoDataUrl(bytes, "people/ada-demo/photos/park.png");
  assert.ok(url?.startsWith("data:image/png;base64,"));
  assert.doesNotMatch(url ?? "", /https?:/);
  assert.equal(localPhotoDataUrl(new Uint8Array(), "park.png"), null);
  assert.equal(localPhotoDataUrl(bytes, "park.bin"), null);
});
