import assert from "node:assert/strict";
import { test } from "node:test";
import type { FactSuggestion } from "../models.ts";
import {
  assertNoAutoWrite,
  keepFetchedPhoto,
  proposeOnly,
  writesForAcceptedSuggestion,
} from "./research.ts";
import {
  discoverPhotoFacts,
  extractProfilePhotoUrls,
  isLikelyProfilePhotoUrl,
  mergePhotoSuggestions,
  photoFactsFromHtml,
  publicPageUrlsFromPerson,
  publicPageUrlsFromSuggestions,
} from "./page-photos.ts";

const HOMEPAGE = "https://sondre.example/";
const HEADSHOT = "https://sondre.example/images/sondre.jpg";
const OG = "https://sondre.example/images/og-sondre.jpg";
const WIKI = "https://en.wikipedia.org/wiki/Ada_Lovelace";
const WIKI_PHOTO = "https://upload.wikimedia.org/wikipedia/commons/a/a4/Ada_Lovelace_portrait.jpg";

const HOMEPAGE_HTML = `
<html>
  <head>
    <meta property="og:image" content="${OG}" />
    <meta name="twitter:image" content="${OG}" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" sizes="180x180" />
  </head>
  <body>
    <img class="logo" src="/logo.svg" alt="Site logo" width="120" height="40" />
    <img class="headshot" src="/images/sondre.jpg" alt="Sondre Bjellås" />
  </body>
</html>
`;

const WIKI_HTML = `
<html>
  <head>
    <meta property="og:image" content="${WIKI_PHOTO}" />
    <link rel="icon" href="/static/favicon/wikipedia.ico" />
  </head>
  <body>
    <img src="/static/images/mobile/copyright/wikipedia-wordmark-en.svg" alt="Wikipedia" width="120" />
  </body>
</html>
`;

test("research proposes a photo fact from og:image and an obvious headshot", () => {
  const writes: unknown[] = [];
  const urls = extractProfilePhotoUrls(HOMEPAGE_HTML, HOMEPAGE, ["Sondre", "Sondre Bjellås"]);
  assert.ok(urls.includes(OG));
  assert.ok(urls.includes(HEADSHOT));
  assert.equal(urls.some((url) => /favicon|apple-touch|logo\.svg/i.test(url)), false);

  const facts = photoFactsFromHtml(HOMEPAGE_HTML, HOMEPAGE, {
    source: "research",
    names: ["Sondre Bjellås"],
    stamp: "site",
  });
  assert.ok(facts.length >= 1);
  assert.equal(facts[0]?.kind, "photo");
  assert.equal(facts[0]?.url, OG);
  assert.equal(facts.every((item) => item.kind === "photo" && item.url && isLikelyProfilePhotoUrl(item.url)), true);
  assert.equal(proposeOnly(facts).length, 0);
  assertNoAutoWrite(writes);
});

test("Wikipedia og:image is a photo fact; rel=icon is not", () => {
  const urls = extractProfilePhotoUrls(WIKI_HTML, WIKI, ["Ada Lovelace"]);
  assert.deepEqual(urls, [WIKI_PHOTO]);
  const facts = photoFactsFromHtml(WIKI_HTML, WIKI, { source: "research", stamp: "wiki" });
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.kind, "photo");
  assert.equal(facts[0]?.url, WIKI_PHOTO);
});

test("tiny icons, favicons, and generated art are not profile photos", () => {
  const html = `
    <html>
      <head>
        <link rel="icon" href="https://sondre.example/favicon.ico" />
        <meta property="og:image" content="https://ui-avatars.com/api/?name=Sondre" />
      </head>
      <body>
        <img src="/icons/twitter.svg" width="16" height="16" alt="icon" />
        <img src="https://www.gravatar.com/avatar/abc?d=mp" alt="avatar" />
        <img src="https://placehold.co/400x400/jpg" alt="placeholder" />
        <img src="/images/blank.gif" width="1" height="1" alt="" />
      </body>
    </html>
  `;
  assert.deepEqual(extractProfilePhotoUrls(html, HOMEPAGE), []);
  assert.equal(isLikelyProfilePhotoUrl("https://sondre.example/favicon.ico"), false);
  assert.equal(isLikelyProfilePhotoUrl("https://ui-avatars.com/api/?name=Ada"), false);
  assert.equal(isLikelyProfilePhotoUrl("https://placehold.co/400.jpg"), false);
  assert.equal(isLikelyProfilePhotoUrl("javascript:alert(1)"), false);
});

test("discoverPhotoFacts fetches known public pages and never writes OKF", async () => {
  const writes: unknown[] = [];
  const fetched: string[] = [];
  const facts = await discoverPhotoFacts(
    [HOMEPAGE, WIKI, "https://sondre.example/images/sondre.jpg"],
    async (url) => {
      fetched.push(url);
      if (url === HOMEPAGE) return HOMEPAGE_HTML;
      if (url === WIKI) return WIKI_HTML;
      throw new Error("should not fetch a raw image as HTML");
    },
    { source: "research", names: ["Sondre Bjellås"] },
  );
  assert.deepEqual(fetched, [HOMEPAGE, WIKI]);
  assert.ok(facts.some((item) => item.url === OG));
  assert.ok(facts.some((item) => item.url === WIKI_PHOTO) || facts.length >= 1);
  assert.equal(facts.every((item) => item.kind === "photo"), true);
  assert.equal(proposeOnly(facts).length, 0);
  assertNoAutoWrite(writes);
});

test("Accept of a page photo writes local bytes; rejecting writes nothing", () => {
  const writes: unknown[] = [];
  const facts = photoFactsFromHtml(HOMEPAGE_HTML, HOMEPAGE, { source: "research", stamp: "accept" });
  const photo = facts[0]!;
  assert.equal(proposeOnly([photo]).length, 0);
  assertNoAutoWrite(writes);

  const rejected: FactSuggestion[] = [];
  const kept = facts.filter((item) => item.id !== photo.id);
  assert.equal(kept.some((item) => item.id === photo.id), false);
  assert.deepEqual(proposeOnly(rejected), []);
  assertNoAutoWrite(writes);

  const intent = writesForAcceptedSuggestion("sondre-bjellas", photo);
  assert.deepEqual(intent, {
    type: "photo",
    slug: "sondre-bjellas",
    url: photo.url,
    title: photo.title,
  });
  if (intent.type !== "photo") throw new Error("expected photo write");
  assert.equal(keepFetchedPhoto(intent, null), null);
  const stored = keepFetchedPhoto(intent, new Uint8Array([137, 80, 78, 71]));
  assert.ok(stored);
  assert.equal(stored.bytes.byteLength, 4);
  assert.equal(stored.slug, "sondre-bjellas");
  assert.equal(stored.url, photo.url);
});

test("merge prefers page photos, drops placeholders, and dedupes URLs", () => {
  const model: FactSuggestion[] = [
    { id: "n1", source: "research", kind: "note", title: "Talk", body: "Spoke in public." },
    {
      id: "p-fake",
      source: "research",
      kind: "photo",
      title: "Generated",
      url: "https://ui-avatars.com/api/?name=Ada",
    },
    { id: "p-dup", source: "research", kind: "photo", title: "Same og", url: OG },
  ];
  const page = photoFactsFromHtml(HOMEPAGE_HTML, HOMEPAGE, { stamp: "merge" });
  const merged = mergePhotoSuggestions(model, page);
  assert.equal(merged.some((item) => item.kind === "note"), true);
  assert.equal(merged.filter((item) => item.kind === "photo" && item.url === OG).length, 1);
  assert.equal(merged.some((item) => item.url?.includes("ui-avatars")), false);
  assert.equal(proposeOnly(merged).length, 0);
});

test("known person and suggestion social URLs are the research pages", () => {
  const pages = publicPageUrlsFromPerson({
    social: [
      { id: "s1", path: "x", title: "Site", url: HOMEPAGE },
      { id: "s2", path: "y", title: "Pic", url: HEADSHOT },
    ],
  });
  assert.deepEqual(pages, [HOMEPAGE]);
  const fromFacts = publicPageUrlsFromSuggestions([
    { id: "s", source: "research", kind: "social", title: "Wiki", url: WIKI },
    { id: "p", source: "research", kind: "photo", title: "Pic", url: HEADSHOT },
  ]);
  assert.deepEqual(fromFacts, [WIKI]);
});
