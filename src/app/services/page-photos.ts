/**
 * Discover real profile / headshot URLs from public HTML already in the
 * research path. Suggestions only — Accept is the write. Never invent a face.
 */
import type { FactSuggestion, PersonView, SuggestionSource } from "../models";

export const MAX_PAGE_PHOTOS = 3;
export const MAX_RESEARCH_PAGES = 5;

const ICON_REL = /\b(icon|shortcut\s+icon|apple-touch-icon|mask-icon|fluid-icon)\b/i;
const SKIP_PATH =
  /favicon|apple-touch-icon|android-chrome|mstile|safari-pinned|\.ico(?:$|\?)|\/icons?\/|sprite/i;
const SKIP_HOST =
  /(?:^|\.)(?:ui-avatars\.com|placeholder\.com|placehold\.co|dummyimage\.com|via\.placeholder\.com|gravatar\.com|secure\.gravatar\.com|dicebear\.com|boringavatars\.com|generated\.photos|thispersondoesnotexist\.com)$/i;
const SKIP_QUERY = /[?&]d=(?:mp|identicon|monsterid|wavatar|retro|robohash)\b/i;
const GENERATED =
  /placeholder|default[-_]avatar|mystery[-_]man|opengraph[-_]default|og[-_]default|generated[-_](?:avatar|face|art)|no[-_]photo|blank[-_]avatar/i;
const HEADSHOT =
  /portrait|headshot|profile[-_\s]?photo|photo[-_\s]?of|profile[-_\s]?pic|bio[-_\s]?photo|about[-_\s]?photo|person[-_\s]?photo|og[-_\s]?image/i;
const LOGO_HINT = /\b(logo|icon|sprite|badge|button|emoji|favicon|wordmark)\b/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(?:$|\?)/i;
const PAGE_IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg|ico)(?:$|\?)/i;

export type PhotoCandidate = {
  url: string;
  score: number;
  title: string;
};

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizePhotoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url.trim();
  }
}

/** Favicons, generated avatars, and placeholder art are not profile photos. */
export function isLikelyProfilePhotoUrl(url: string): boolean {
  if (!isPublicHttpUrl(url)) return false;
  try {
    const parsed = new URL(url);
    if (SKIP_HOST.test(parsed.hostname)) return false;
    if (SKIP_PATH.test(parsed.pathname) || SKIP_PATH.test(url)) return false;
    if (SKIP_QUERY.test(parsed.search)) return false;
    if (GENERATED.test(url)) return false;
    if (/\.svg(?:$|\?)/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isLikelyHtmlPage(url: string): boolean {
  if (!isPublicHttpUrl(url)) return false;
  try {
    const path = new URL(url).pathname;
    return !PAGE_IMAGE_EXT.test(path);
  } catch {
    return false;
  }
}

export function uniqueHttpUrls(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const raw = value?.trim() ?? "";
    if (!isPublicHttpUrl(raw)) continue;
    const key = normalizePhotoUrl(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

export function publicPageUrlsFromPerson(person: Pick<PersonView, "social">): string[] {
  return uniqueHttpUrls(person.social.map((item) => item.url)).filter(isLikelyHtmlPage);
}

export function publicPageUrlsFromSuggestions(suggestions: FactSuggestion[]): string[] {
  return uniqueHttpUrls(
    suggestions.filter((item) => item.kind === "social").map((item) => item.url),
  ).filter(isLikelyHtmlPage);
}

export function namesForPhotoMatch(person: Pick<PersonView, "title" | "givenName" | "familyName">): string[] {
  const parts = [person.title, person.givenName, person.familyName];
  if (person.givenName && person.familyName) {
    parts.push(`${person.givenName} ${person.familyName}`);
  }
  return [...new Set(parts.map((item) => item?.trim() ?? "").filter((item) => item.length >= 2))];
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function tags(html: string, name: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    out.push(parseAttrs(match[1] ?? ""));
  }
  return out;
}

function resolvePageUrl(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^(data:|javascript:|blob:|#)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function tinyDeclaredSize(attrs: Record<string, string>): boolean {
  const width = Number.parseInt(attrs.width ?? "", 10);
  const height = Number.parseInt(attrs.height ?? "", 10);
  const sizes = attrs.sizes ?? "";
  if (Number.isFinite(width) && width > 0 && width <= 64) return true;
  if (Number.isFinite(height) && height > 0 && height <= 64) return true;
  if (/\b(?:16|24|32|48)x(?:16|24|32|48)\b/i.test(sizes)) return true;
  return false;
}

function looksLikeLogo(text: string): boolean {
  return LOGO_HINT.test(text) && !HEADSHOT.test(text);
}

function titleForPhoto(attrs: Record<string, string>, fallback: string): string {
  const alt = attrs.alt?.trim();
  if (alt && alt.length <= 80 && !looksLikeLogo(alt)) return alt;
  return fallback;
}

function nameInText(text: string, names: string[]): boolean {
  const hay = text.toLowerCase();
  return names.some((name) => name.length >= 3 && hay.includes(name.toLowerCase()));
}

function addCandidate(
  found: PhotoCandidate[],
  seen: Set<string>,
  url: string | null,
  score: number,
  title: string,
): void {
  if (!url || !isLikelyProfilePhotoUrl(url)) return;
  const key = normalizePhotoUrl(url);
  if (seen.has(key)) return;
  seen.add(key);
  found.push({ url, score, title });
}

/**
 * Ranked profile/headshot URLs from one public page.
 * og:image wins. rel=icon / tiny icons are skipped.
 */
export function extractProfilePhotoCandidates(
  html: string,
  pageUrl: string,
  names: string[] = [],
): PhotoCandidate[] {
  if (!html.trim() || !isPublicHttpUrl(pageUrl)) return [];
  const found: PhotoCandidate[] = [];
  const seen = new Set<string>();
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      return "page";
    }
  })();

  for (const meta of tags(html, "meta")) {
    const key = `${meta.property ?? ""} ${meta.name ?? ""}`.toLowerCase();
    const content = meta.content ?? "";
    if (/\b(?:og:image|og:image:url|twitter:image|twitter:image:src)\b/.test(key)) {
      addCandidate(found, seen, resolvePageUrl(content, pageUrl), 100, `Photo from ${host}`);
    }
    if (meta.itemprop?.toLowerCase() === "image") {
      addCandidate(found, seen, resolvePageUrl(content, pageUrl), 90, `Photo from ${host}`);
    }
  }

  for (const link of tags(html, "link")) {
    const rel = link.rel ?? "";
    if (ICON_REL.test(rel)) continue;
    if (/\bimage_src\b/i.test(rel)) {
      addCandidate(found, seen, resolvePageUrl(link.href ?? "", pageUrl), 85, `Photo from ${host}`);
    }
  }

  for (const img of tags(html, "img")) {
    if (tinyDeclaredSize(img)) continue;
    const src = resolvePageUrl(img.src ?? img["data-src"] ?? "", pageUrl);
    if (!src) continue;
    const hint = `${img.class ?? ""} ${img.id ?? ""} ${img.alt ?? ""} ${img.title ?? ""}`;
    if (looksLikeLogo(hint) || ICON_REL.test(img.rel ?? "")) continue;
    let score = 20;
    if (HEADSHOT.test(hint) || img.itemprop?.toLowerCase() === "image") score = 80;
    else if (nameInText(hint, names)) score = 70;
    else if (IMAGE_EXT.test(src) && !looksLikeLogo(src)) score = 30;
    else continue;
    addCandidate(found, seen, src, score, titleForPhoto(img, `Photo from ${host}`));
  }

  return found.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

export function extractProfilePhotoUrls(html: string, pageUrl: string, names: string[] = []): string[] {
  return extractProfilePhotoCandidates(html, pageUrl, names).map((item) => item.url);
}

export function photoFactsFromHtml(
  html: string,
  pageUrl: string,
  options?: { source?: SuggestionSource; names?: string[]; stamp?: string },
): FactSuggestion[] {
  const source = options?.source ?? "research";
  const stamp = options?.stamp ?? "page";
  return extractProfilePhotoCandidates(html, pageUrl, options?.names ?? [])
    .slice(0, MAX_PAGE_PHOTOS)
    .map((item, index) => ({
      id: `${source}-page-photo-${stamp}-${index}`,
      source,
      kind: "photo" as const,
      title: item.title,
      url: item.url,
    }));
}

export async function discoverPhotoFacts(
  pages: string[],
  fetchHtml: (url: string) => Promise<string | null>,
  options?: { source?: SuggestionSource; names?: string[] },
): Promise<FactSuggestion[]> {
  const urls = uniqueHttpUrls(pages).filter(isLikelyHtmlPage).slice(0, MAX_RESEARCH_PAGES);
  const found: FactSuggestion[] = [];
  const seen = new Set<string>();
  for (const page of urls) {
    let html: string | null = null;
    try {
      html = await fetchHtml(page);
    } catch {
      html = null;
    }
    if (!html) continue;
    for (const fact of photoFactsFromHtml(html, page, {
      source: options?.source,
      names: options?.names,
      stamp: String(found.length),
    })) {
      const key = normalizePhotoUrl(fact.url ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(fact);
      if (found.length >= MAX_PAGE_PHOTOS) return found;
    }
  }
  return found;
}

/** Page-discovered photos first. Drop generated/icon URLs. Dedupes by URL. */
export function mergePhotoSuggestions(
  existing: FactSuggestion[],
  discovered: FactSuggestion[],
): FactSuggestion[] {
  const rest = existing.filter((item) => item.kind !== "photo");
  const existingPhotos = existing.filter(
    (item) => item.kind === "photo" && item.url && isLikelyProfilePhotoUrl(item.url),
  );
  const seen = new Set(existingPhotos.map((item) => normalizePhotoUrl(item.url!)));
  const extras: FactSuggestion[] = [];
  for (const item of discovered) {
    if (item.kind !== "photo" || !item.url || !isLikelyProfilePhotoUrl(item.url)) continue;
    const key = normalizePhotoUrl(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(item);
  }
  return [...rest, ...extras, ...existingPhotos].slice(0, rest.length + MAX_PAGE_PHOTOS);
}

export function researchPagesForPhotos(
  person: Pick<PersonView, "social"> | null,
  suggestions: FactSuggestion[],
): string[] {
  const known = person ? publicPageUrlsFromPerson(person) : [];
  return uniqueHttpUrls([...known, ...publicPageUrlsFromSuggestions(suggestions)]).filter(isLikelyHtmlPage);
}
