import assert from "node:assert/strict";
import { test } from "node:test";
import { personListPhotoUrl } from "../list-photo.ts";
import {
  DEMO_DIORAMA_PNG,
  DIORAMA_FILE_PREFIX,
  DIORAMA_PHOTO_TITLE,
  DIORAMA_PROMPT,
  IMAGINE_EDITS_URL,
  IMAGINE_MODEL,
  decodeBase64Image,
  dioramaPhotoFileName,
  grokImagineEditRequest,
  imageBytesToDataUrl,
  isDioramaPhoto,
  parseImagineEditResponse,
  personHasDiorama,
  sniffImageMime,
} from "./imagine.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("Imagine edit is grok-imagine-image-2.0 image-to-image with b64_json", () => {
  const dataUrl = imageBytesToDataUrl(PNG, "image/png");
  const live = grokImagineEditRequest(dataUrl);
  assert.equal(live.url, IMAGINE_EDITS_URL);
  assert.equal(live.url, "https://api.x.ai/v1/images/edits");
  assert.equal(live.body.model, IMAGINE_MODEL);
  assert.equal(live.body.model, "grok-imagine-image-2.0");
  assert.equal(live.body.response_format, "b64_json");
  assert.equal(live.body.n, 1);
  assert.equal(live.body.prompt, DIORAMA_PROMPT);
  assert.match(String(live.body.prompt), /clay diorama/i);
  assert.match(String(live.body.prompt), /likeness/i);
  const image = live.body.image as { url?: string; type?: string };
  assert.equal(image.type, "image_url");
  assert.equal(image.url, dataUrl);
  assert.match(image.url ?? "", /^data:image\/png;base64,/);
});

test("Imagine request sends only the local photo — never the people-graph or tokens", () => {
  const dataUrl = imageBytesToDataUrl(PNG);
  const live = grokImagineEditRequest(dataUrl);
  const json = JSON.stringify(live.body);
  assert.doesNotMatch(json, /people-graph|Ada Demo Twin|bea-demo|notes|social|access_token|grok_oauth|localStorage/);
  assert.doesNotMatch(json, /https?:\/\//);
  assert.equal("messages" in live.body, false);
  assert.equal("tools" in live.body, false);
});

test("Imagine refuses a remote reference URL — only a local data URL", () => {
  assert.throws(
    () => grokImagineEditRequest("https://imgen.x.ai/tmp/ada.png"),
    /local image data URL/,
  );
  assert.throws(() => grokImagineEditRequest("http://cdn.example/ada.jpg"), /local image data URL/);
});

test("b64_json is saved as local bytes — temporary Imagine URLs stay download-only", () => {
  const raw = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/APwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const fromB64 = parseImagineEditResponse({ data: [{ b64_json: raw }] });
  assert.equal(fromB64.kind, "bytes");
  if (fromB64.kind === "bytes") {
    assert.equal(fromB64.mime, "image/png");
    assert.ok(fromB64.bytes.byteLength > 0);
    assert.equal(sniffImageMime(fromB64.bytes), "image/png");
  }

  const remote = "https://imgen.x.ai/tmp/diorama-ada.png";
  const fromUrl = parseImagineEditResponse({ data: [{ url: remote }] });
  assert.equal(fromUrl.kind, "url");
  if (fromUrl.kind === "url") {
    assert.equal(fromUrl.url, remote);
    assert.equal(personListPhotoUrl(fromUrl.url), null);
  }
});

test("data-URI Imagine results decode without becoming a list src host", () => {
  const dataUrl = imageBytesToDataUrl(DEMO_DIORAMA_PNG, "image/png");
  const parsed = parseImagineEditResponse({ data: [{ url: dataUrl }] });
  assert.equal(parsed.kind, "bytes");
  if (parsed.kind === "bytes") {
    assert.deepEqual(parsed.bytes, DEMO_DIORAMA_PNG);
  }
  assert.deepEqual(decodeBase64Image(dataUrl), DEMO_DIORAMA_PNG);
});

test("empty Imagine payload is an error — nothing to write", () => {
  assert.throws(() => parseImagineEditResponse({ data: [{}] }), /did not return an image/);
  assert.throws(() => parseImagineEditResponse({}), /did not return an image/);
});

test("diorama mark is filename or title — never guessed from pixels", () => {
  const written = dioramaPhotoFileName("png");
  assert.match(written, new RegExp(`^${DIORAMA_FILE_PREFIX}[a-z0-9]+\\.png$`));
  assert.equal(isDioramaPhoto({ fileName: written, title: DIORAMA_PHOTO_TITLE }), true);
  assert.equal(isDioramaPhoto({ title: DIORAMA_PHOTO_TITLE }), true);
  assert.equal(
    isDioramaPhoto({ resource: "/people/ada-demo/photos/diorama-m1n2.png" }),
    true,
  );
  assert.equal(isDioramaPhoto({ path: "people/ada-demo/photos/diorama-m1n2.md" }), true);
  assert.equal(isDioramaPhoto({ fileName: "portrait.png", title: "portrait.png" }), false);
  assert.equal(isDioramaPhoto({ title: "Park day", resource: "/people/ada-demo/photos/park.png" }), false);
  assert.equal(isDioramaPhoto({ title: "", fileName: "clay-look.png" }), false);
  assert.equal(
    personHasDiorama({
      image: "/people/ada-demo/photos/portrait.png",
      photos: [{ title: "portrait.png", resource: "/people/ada-demo/photos/portrait.png" }],
    }),
    false,
  );
  assert.equal(
    personHasDiorama({
      image: "/people/ada-demo/photos/other.png",
      photos: [
        { title: "other.png", resource: "/people/ada-demo/photos/other.png" },
        { title: DIORAMA_PHOTO_TITLE, resource: `/people/ada-demo/photos/${written}` },
      ],
    }),
    true,
  );
  assert.equal(
    personHasDiorama({ image: "/people/ada-demo/photos/diorama-abc.png", photos: [] }),
    true,
  );
  assert.equal(personHasDiorama({ photos: [] }), false);
});
