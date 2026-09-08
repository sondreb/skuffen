import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const OKF_VERSION = "0.2";
export const PERSON_TYPE = "Person";
export const NOTE_TYPE = "Note";
export const PHOTO_TYPE = "Photo";
export const SOCIAL_TYPE = "SocialProfile";
export const PLACE_TYPE = "Place";
export const PLACE_LINKS_TYPE = "PlaceLinks";
export const PLACE_FILE_TYPE = "File";
export const DOCUMENT_TYPE = "Document";
export const DOCUMENT_KIND = "document";
export const RELATIONS_TYPE = "Relations";

export type OkfType =
  | typeof PERSON_TYPE
  | typeof NOTE_TYPE
  | typeof PHOTO_TYPE
  | typeof SOCIAL_TYPE
  | typeof PLACE_TYPE
  | typeof PLACE_LINKS_TYPE
  | typeof PLACE_FILE_TYPE
  | typeof DOCUMENT_TYPE
  | typeof RELATIONS_TYPE
  | string;

export type RelationKind = "family" | "business" | "other";

export const FAMILY_ROLES = ["partner", "parent", "child", "sibling"] as const;
export const BUSINESS_ROLES = ["colleague", "manager", "client"] as const;
export const OTHER_ROLES = ["friend", "neighbor"] as const;

export type PresetRelationRole =
  | (typeof FAMILY_ROLES)[number]
  | (typeof BUSINESS_ROLES)[number]
  | (typeof OTHER_ROLES)[number];

export interface OkfRelation {
  /** family | business | other */
  kind: RelationKind;
  /** Preset role or a free-text family/business/other role. */
  role: string;
  /** Bundle path of the other person. File path is identity. */
  person: string;
}

/** How a person is tied to a first-class Place. No land-plot kind. */
export const PLACE_LINK_ROLES = ["lives", "works", "met-at"] as const;
export type PlaceLinkRole = (typeof PLACE_LINK_ROLES)[number];

export interface OkfPlaceLink {
  role: PlaceLinkRole;
  /** Bundle path of the Place. File path is identity. */
  place: string;
}

export type PlaceSource = "search" | "pin";

export interface OkfActorStamp {
  by: string;
  at: string;
}

export interface OkfSource {
  id?: string;
  resource: string;
  title?: string;
  author?: string;
}

export type OkfStatus = "draft" | "stable" | "deprecated";

export interface OkfFrontmatter {
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  generated?: OkfActorStamp;
  verified?: OkfActorStamp | OkfActorStamp[];
  status?: OkfStatus;
  sources?: OkfSource[];
  /** ISO date (YYYY-MM-DD) or datetime when this fact should be reconsidered. */
  stale_after?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  phone?: string;
  network?: string;
  handle?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  source?: string;
  kind?: string;
  subjects?: string[];
  /** Bundle-relative profile image. Never http(s). */
  image?: string;
  /** Typed links to other local people. Only on relations.md. */
  relations?: OkfRelation[];
  /** Typed links from a person to first-class Places. Only on place-links.md. */
  links?: OkfPlaceLink[];
}

export interface OkfDocument {
  /** Concept ID: bundle-relative path with `.md` removed. */
  id: string;
  /** Bundle-relative path including `.md`. */
  path: string;
  frontmatter: OkfFrontmatter;
  body: string;
}

export interface PersonFields {
  given_name?: string;
  family_name?: string;
  email?: string;
  phone?: string;
}

export interface SocialFields {
  network?: string;
  handle?: string;
}

export interface PlaceFields {
  latitude: number;
  longitude: number;
  address?: string;
  source?: string;
}

/** Optional stamps written with a new OKF concept. */
export interface OkfCreateProvenance {
  generatedBy?: string;
  /** Omit or pass false for generated-only (model write before human Accept). */
  verifiedBy?: string | false;
  sources?: OkfSource[];
  status?: OkfStatus;
  staleAfter?: string;
}

export interface PlaceLocation {
  path: string;
  title: string;
  address?: string;
  latitude: number;
  longitude: number;
  source?: string;
}

export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function todayUtc(): string {
  return nowUtc().slice(0, 10);
}

export function actorHuman(name = "user"): string {
  return `human:${name}`;
}

export function actorAgent(provider: "grok" | "gemini", model: string): string {
  return `${provider}/${model}`;
}

export function isAgentActor(by: string): boolean {
  return /^(grok|gemini)\//.test(by.trim());
}

export function actorStamp(by: string, at = nowUtc()): OkfActorStamp {
  return { by: by.trim(), at };
}

const OKF_STATUSES = new Set<OkfStatus>(["draft", "stable", "deprecated"]);

export function normalizeActorStamp(value: unknown): OkfActorStamp | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const by = typeof raw["by"] === "string" ? raw["by"].trim() : "";
  let at = "";
  if (typeof raw["at"] === "string") at = raw["at"].trim();
  else if (raw["at"] instanceof Date && !Number.isNaN(raw["at"].getTime())) {
    at = raw["at"].toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (!by || !at) return undefined;
  return { by, at };
}

export function normalizeSources(value: unknown): OkfSource[] {
  if (typeof value === "string" && value.trim()) {
    return [{ resource: value.trim() }];
  }
  if (!Array.isArray(value)) return [];
  const out: OkfSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      const resource = item.trim();
      const key = resource.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ resource });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const resource = typeof raw["resource"] === "string" ? raw["resource"].trim() : "";
    if (!resource) continue;
    const key = resource.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const source: OkfSource = { resource };
    if (typeof raw["id"] === "string" && raw["id"].trim()) source.id = raw["id"].trim();
    if (typeof raw["title"] === "string" && raw["title"].trim()) source.title = raw["title"].trim();
    if (typeof raw["author"] === "string" && raw["author"].trim()) source.author = raw["author"].trim();
    out.push(source);
  }
  return out;
}

export function mergeSources(existing: unknown, extra?: unknown): OkfSource[] {
  return normalizeSources([...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...(Array.isArray(extra) ? extra : extra ? [extra] : [])]);
}

export function normalizeStatus(value: unknown): OkfStatus | undefined {
  return typeof value === "string" && OKF_STATUSES.has(value as OkfStatus) ? (value as OkfStatus) : undefined;
}

export function normalizeStaleAfter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Default reconsider-by date for hostile-web research facts. Local human writes omit this. */
export function defaultStaleAfter(from = nowUtc(), days = 180): string {
  const ms = Date.parse(from);
  const start = Number.isFinite(ms) ? ms : Date.now();
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function provenanceFields(input: OkfCreateProvenance = {}): Pick<
  OkfFrontmatter,
  "generated" | "verified" | "sources" | "status" | "stale_after"
> {
  const at = nowUtc();
  const generatedBy = input.generatedBy?.trim() || actorHuman();
  const fields: Pick<OkfFrontmatter, "generated" | "verified" | "sources" | "status" | "stale_after"> = {
    generated: actorStamp(generatedBy, at),
  };
  if (input.verifiedBy !== false) {
    if (typeof input.verifiedBy === "string" && input.verifiedBy.trim()) {
      fields.verified = actorStamp(input.verifiedBy, at);
    } else if (!isAgentActor(generatedBy)) {
      fields.verified = actorStamp(actorHuman(), at);
    }
  }
  const sources = normalizeSources(input.sources);
  if (sources.length) fields.sources = sources;
  if (input.status) fields.status = input.status;
  const stale = normalizeStaleAfter(input.staleAfter);
  if (stale) fields.stale_after = stale;
  return fields;
}

export function appendVerified(frontmatter: OkfFrontmatter, by: string, at = nowUtc()): OkfFrontmatter {
  const next = actorStamp(by, at);
  const list = verifiedList(frontmatter.verified);
  const already = list.some((item) => item.by === next.by && item.at === next.at);
  if (!already) list.push(next);
  frontmatter.verified = list.length === 1 ? list[0] : list;
  return frontmatter;
}

/** Human Accept: keep model `generated`, add `verified`, mark stable. */
export function acceptHumanVerification(frontmatter: OkfFrontmatter, at = nowUtc()): OkfFrontmatter {
  appendVerified(frontmatter, actorHuman(), at);
  frontmatter.status = "stable";
  return frontmatter;
}

export function applyAcceptProvenance(
  frontmatter: OkfFrontmatter,
  input: { generatedBy?: string; sources?: OkfSource[]; staleAfter?: string },
): OkfFrontmatter {
  if (input.generatedBy && isAgentActor(input.generatedBy) && !frontmatter.generated) {
    frontmatter.generated = actorStamp(input.generatedBy);
  }
  acceptHumanVerification(frontmatter);
  const sources = mergeSources(frontmatter.sources, input.sources);
  if (sources.length) frontmatter.sources = sources;
  const stale = normalizeStaleAfter(input.staleAfter);
  if (stale) frontmatter.stale_after = stale;
  return frontmatter;
}

export function conceptId(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.md$/i, "");
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

export function parseDocument(path: string, raw: string): OkfDocument {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`OKF document ${path} is missing a YAML frontmatter block`);
  }
  const parsed = parseYaml(match[1]) ?? {};
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
    throw new Error(`OKF document ${path} has non-object frontmatter`);
  }
  const frontmatter = normalizeFrontmatterProvenance(parsed as OkfFrontmatter);
  if (typeof frontmatter.type !== "string" || !frontmatter.type.trim()) {
    throw new Error(`OKF document ${path} is missing required frontmatter key: type`);
  }
  if (frontmatter.type === DOCUMENT_TYPE) {
    if (typeof frontmatter.title !== "string" || !frontmatter.title.trim()) {
      throw new Error(`OKF document ${path} is missing required frontmatter key: title`);
    }
    if (typeof frontmatter.resource !== "string" || !frontmatter.resource.trim()) {
      throw new Error(`OKF document ${path} is missing required frontmatter key: resource`);
    }
  }
  return {
    id: conceptId(path),
    path: path.replace(/\\/g, "/"),
    frontmatter,
    body: match[2].replace(/^\r?\n/, ""),
  };
}

function normalizeFrontmatterProvenance(frontmatter: OkfFrontmatter): OkfFrontmatter {
  const generated = normalizeActorStamp(frontmatter.generated);
  if (generated) frontmatter.generated = generated;
  else delete frontmatter.generated;
  const verified = verifiedList(frontmatter.verified)
    .map((item) => normalizeActorStamp(item))
    .filter((item): item is OkfActorStamp => Boolean(item));
  if (verified.length === 1) frontmatter.verified = verified[0];
  else if (verified.length > 1) frontmatter.verified = verified;
  else delete frontmatter.verified;
  const sources = normalizeSources(frontmatter.sources);
  if (sources.length) frontmatter.sources = sources;
  else delete frontmatter.sources;
  const status = normalizeStatus(frontmatter.status);
  if (status) frontmatter.status = status;
  else delete frontmatter.status;
  const stale = normalizeStaleAfter(frontmatter.stale_after);
  if (stale) frontmatter.stale_after = stale;
  else delete frontmatter.stale_after;
  return frontmatter;
}

export function serializeDocument(doc: Pick<OkfDocument, "frontmatter" | "body">): string {
  const yaml = stringifyYaml(doc.frontmatter, { lineWidth: 0 }).trimEnd();
  const body = doc.body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `---\n${yaml}\n---\n${body ? `\n${body}\n` : ""}`;
}

export function parseIndex(raw: string): { okfVersion?: string; body: string } {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { body: normalized };
  }
  const parsed = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const version = parsed["okf_version"];
  return {
    okfVersion: typeof version === "string" ? version : undefined,
    body: match[2].replace(/^\r?\n/, ""),
  };
}

export function serializeBundleIndex(
  entries: { title: string; path: string; description?: string }[],
  places: { title: string; path: string; description?: string }[] = [],
): string {
  const lines = [
    "---",
    `okf_version: "${OKF_VERSION}"`,
    "---",
    "",
    "# Skuffen",
    "",
    "Local personal intelligence. The people-graph lives on this machine as an Open Knowledge Format v0.2 bundle.",
    "",
    "# People",
    "",
  ];
  if (entries.length === 0) {
    lines.push("*Empty — add a person in Skuffen. Data stays on disk.*", "");
  } else {
    for (const entry of entries) {
      const desc = entry.description?.trim() ? ` - ${entry.description.trim()}` : "";
      lines.push(`* [${entry.title}](${entry.path}) ${desc}`.trimEnd());
    }
    lines.push("");
  }
  lines.push("# Places", "");
  if (places.length === 0) {
    lines.push("*Empty — add a place in Skuffen. Data stays on disk.*", "");
  } else {
    for (const entry of places) {
      const desc = entry.description?.trim() ? ` - ${entry.description.trim()}` : "";
      lines.push(`* [${entry.title}](${entry.path}) ${desc}`.trimEnd());
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function serializePeopleIndex(entries: { title: string; path: string; description?: string }[]): string {
  const lines = ["# People", ""];
  if (entries.length === 0) {
    lines.push("*No people yet.*", "");
  } else {
    for (const entry of entries) {
      const desc = entry.description?.trim() ? ` - ${entry.description.trim()}` : "";
      lines.push(`* [${entry.title}](${entry.path}) ${desc}`.trimEnd());
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function serializePlacesIndex(entries: { title: string; path: string; description?: string }[]): string {
  const lines = ["# Places", ""];
  if (entries.length === 0) {
    lines.push("*No places yet.*", "");
  } else {
    for (const entry of entries) {
      const desc = entry.description?.trim() ? ` - ${entry.description.trim()}` : "";
      lines.push(`* [${entry.title}](${entry.path}) ${desc}`.trimEnd());
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function emptyLog(): string {
  return `# Directory Update Log

## ${todayUtc()}
* **Initialization**: Created Skuffen OKF v${OKF_VERSION} people-graph bundle.
`;
}

export function appendLog(existing: string, kind: string, detail: string): string {
  const date = todayUtc();
  const heading = `## ${date}`;
  const entry = `* **${kind}**: ${detail}`;
  const source = existing.trim() ? existing.replace(/\s+$/, "") + "\n" : `# Directory Update Log\n`;
  if (source.includes(heading)) {
    return source.replace(heading, `${heading}\n${entry}`);
  }
  const parts = source.split("\n");
  const insertAt = parts.findIndex((line) => line.startsWith("## "));
  if (insertAt === -1) {
    return `${source}\n${heading}\n${entry}\n`;
  }
  parts.splice(insertAt, 0, heading, entry, "");
  return parts.join("\n") + (parts[parts.length - 1] === "" ? "" : "\n");
}

export function personDir(slug: string): string {
  return `people/${slug}`;
}

export function personPath(slug: string): string {
  return `${personDir(slug)}/person.md`;
}

export function notePath(slug: string, noteSlug: string): string {
  return `${personDir(slug)}/notes/${noteSlug}.md`;
}

export function socialPath(slug: string, networkSlug: string): string {
  return `${personDir(slug)}/social/${networkSlug}.md`;
}

export function photoConceptPath(slug: string, fileStem: string): string {
  return `${personDir(slug)}/photos/${fileStem}.md`;
}

export function photoFilePath(slug: string, fileName: string): string {
  return `${personDir(slug)}/photos/${fileName}`;
}

export function placePath(slug: string): string {
  return `${personDir(slug)}/place.md`;
}

/** First-class Place folder. Path is identity — not a person pin. */
export function entityPlaceDir(slug: string): string {
  return `places/${slug}`;
}

export function entityPlacePath(slug: string): string {
  return `${entityPlaceDir(slug)}/place.md`;
}

export function placeLinksPath(slug: string): string {
  return `${personDir(slug)}/place-links.md`;
}

export function placeNotePath(slug: string, noteSlug: string): string {
  return `${entityPlaceDir(slug)}/notes/${noteSlug}.md`;
}

export function placeFileDir(slug: string): string {
  return `${entityPlaceDir(slug)}/files`;
}

export function placeFilePath(slug: string, fileName: string): string {
  return `${placeFileDir(slug)}/${sanitizeFileName(fileName)}`;
}

export function placeFileConceptPath(slug: string, fileStem: string): string {
  return `${placeFileDir(slug)}/${fileStem}.md`;
}

export function relationsPath(slug: string): string {
  return `${personDir(slug)}/relations.md`;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function parseCoordinate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function locationFromDocument(doc: OkfDocument): PlaceLocation | null {
  if (doc.frontmatter.type !== PLACE_TYPE) return null;
  const latitude = parseCoordinate(doc.frontmatter.latitude);
  const longitude = parseCoordinate(doc.frontmatter.longitude);
  if (latitude === undefined || longitude === undefined) return null;
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  const address = optionalFrontmatterString(doc.frontmatter.address);
  return {
    path: doc.path,
    title: optionalFrontmatterString(doc.frontmatter.title) ?? address ?? doc.id,
    address,
    latitude,
    longitude,
    source: optionalFrontmatterString(doc.frontmatter.source),
  };
}

function optionalFrontmatterString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function documentDir(docSlug: string): string {
  return `documents/${docSlug}`;
}

export function documentConceptPath(docSlug: string): string {
  return `${documentDir(docSlug)}/document.md`;
}

export function documentFilePath(docSlug: string, fileName: string): string {
  return `${documentDir(docSlug)}/${sanitizeFileName(fileName)}`;
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()?.trim() || "file";
  const cleaned = base.replace(/[^\w.\-()+ ]+/g, "_").replace(/^\.+/, "");
  return cleaned || "file";
}

const REMOTE_OR_SCRIPT = /^(https?:|\/\/|javascript:|data:|blob:)/i;

/**
 * Person profile image: local bundle path only.
 * Remote or script URLs are dropped so the people list never fetches them.
 */
export function personImageResource(value?: string | null): string | undefined {
  const raw = value?.trim() ?? "";
  if (!raw || REMOTE_OR_SCRIPT.test(raw) || raw.includes("://") || raw.includes("..")) {
    return undefined;
  }
  const path = raw.replace(/^\//, "");
  if (!path) return undefined;
  return `/${path}`;
}

export function subjectPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

/** Local person tag. Leading # is stripped. Empty after trim is dropped. */
export function normalizeTag(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^#+\s*/, "").trim().replace(/\s+/g, " ");
}

/** Deduped tags, first casing wins. File path stays identity — tags are labels only. */
export function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function documentLinkedToPerson(frontmatter: OkfFrontmatter, slug: string): boolean {
  return subjectPaths(frontmatter.subjects).includes(personPath(slug));
}

export function verifiedList(value: OkfFrontmatter["verified"]): OkfActorStamp[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((item) => normalizeActorStamp(item)).filter((item): item is OkfActorStamp => Boolean(item));
}

export interface OkfProvenanceView {
  generated?: OkfActorStamp;
  verified: OkfActorStamp[];
  sources: OkfSource[];
  status?: OkfStatus;
  staleAfter?: string;
}

export function provenanceFromFrontmatter(frontmatter: OkfFrontmatter): OkfProvenanceView {
  return {
    generated: normalizeActorStamp(frontmatter.generated),
    verified: verifiedList(frontmatter.verified),
    sources: normalizeSources(frontmatter.sources),
    status: normalizeStatus(frontmatter.status),
    staleAfter: normalizeStaleAfter(frontmatter.stale_after),
  };
}

export function hasVisibleProvenance(value: OkfProvenanceView): boolean {
  if (value.sources.length > 0 || value.staleAfter) return true;
  return Boolean(value.generated && isAgentActor(value.generated.by));
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export function redactSensitiveText(value: string): string {
  return value.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
}

export function redactSensitiveRecord<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveRecord(item)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === "email" || key === "phone") {
        out[key] = inner ? "[redacted]" : inner;
      } else {
        out[key] = redactSensitiveRecord(inner);
      }
    }
    return out as T;
  }
  return value;
}

export function createPersonDocument(input: {
  slug: string;
  title: string;
  description?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  image?: string;
  tags?: string[];
  body?: string;
} & OkfCreateProvenance): OkfDocument {
  const tags = normalizeTagList(input.tags);
  const frontmatter: OkfFrontmatter & PersonFields = {
    type: PERSON_TYPE,
    title: input.title,
    description: input.description || undefined,
    given_name: input.givenName || undefined,
    family_name: input.familyName || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
    image: personImageResource(input.image),
    tags: tags.length ? tags : undefined,
    ...provenanceFields(input),
  };
  return {
    id: conceptId(personPath(input.slug)),
    path: personPath(input.slug),
    frontmatter,
    body: input.body?.trim()
      ? input.body.trim()
      : `# About\n\nNotes and social links for ${input.title} live beside this document.\n`,
  };
}

export function createNoteDocument(input: {
  slug: string;
  noteSlug: string;
  title: string;
  body: string;
} & OkfCreateProvenance): OkfDocument {
  return {
    id: conceptId(notePath(input.slug, input.noteSlug)),
    path: notePath(input.slug, input.noteSlug),
    frontmatter: {
      type: NOTE_TYPE,
      title: input.title,
      ...provenanceFields(input),
    },
    body: `${input.body.trim()}\n\nSee [${input.slug}](/${personPath(input.slug)}).\n`,
  };
}

export function createSocialDocument(input: {
  slug: string;
  network: string;
  handle?: string;
  url: string;
} & OkfCreateProvenance): OkfDocument {
  const networkSlug = slugify(input.network);
  const title = input.handle
    ? `${input.handle} on ${input.network}`
    : `${input.network} profile`;
  const frontmatter: OkfFrontmatter & SocialFields = {
    type: SOCIAL_TYPE,
    title,
    resource: input.url,
    network: input.network,
    handle: input.handle,
    ...provenanceFields(input),
  };
  return {
    id: conceptId(socialPath(input.slug, networkSlug)),
    path: socialPath(input.slug, networkSlug),
    frontmatter,
    body: `${title}.\n\nBelongs to [${input.slug}](/${personPath(input.slug)}).\n`,
  };
}

export function createPhotoDocument(input: {
  slug: string;
  fileName: string;
  title?: string;
} & OkfCreateProvenance): OkfDocument {
  const fileStem = input.fileName.replace(/\.[^.]+$/, "");
  const resource = `/${photoFilePath(input.slug, input.fileName)}`;
  return {
    id: conceptId(photoConceptPath(input.slug, fileStem)),
    path: photoConceptPath(input.slug, fileStem),
    frontmatter: {
      type: PHOTO_TYPE,
      title: input.title ?? input.fileName,
      resource,
      ...provenanceFields(input),
    },
    body: `Photo file stored beside this concept at \`${resource}\`. Not inlined as a markdown blob.\n\nSubject: [${input.slug}](/${personPath(input.slug)}).\n`,
  };
}

export function createPlaceDocument(input: {
  slug: string;
  title?: string;
  address?: string;
  latitude: number;
  longitude: number;
  source?: PlaceSource | string;
} & OkfCreateProvenance): OkfDocument {
  if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) {
    throw new Error("Place requires a finite latitude [-90, 90] and longitude [-180, 180]");
  }
  const address = input.address?.trim() || undefined;
  const title = input.title?.trim() || address || `${input.latitude.toFixed(5)}, ${input.longitude.toFixed(5)}`;
  const frontmatter: OkfFrontmatter & PlaceFields = {
    type: PLACE_TYPE,
    title,
    address,
    latitude: input.latitude,
    longitude: input.longitude,
    source: input.source,
    ...provenanceFields(input),
  };
  return {
    id: conceptId(placePath(input.slug)),
    path: placePath(input.slug),
    frontmatter,
    body: `Location for [${input.slug}](/${personPath(input.slug)}).\n\nCoordinates stay in this OKF bundle. Map tiles and address search may use the public internet.\n`,
  };
}

/**
 * First-class Place at places/{slug}/place.md.
 * Path is identity. Lat/lng optional. No land-plot kind.
 */
export function createEntityPlaceDocument(input: {
  slug: string;
  title: string;
  notes?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  source?: PlaceSource | string;
} & OkfCreateProvenance): OkfDocument {
  const title = input.title.trim();
  if (!title) throw new Error("Place requires a name");
  const hasLat = input.latitude !== undefined && input.latitude !== null;
  const hasLng = input.longitude !== undefined && input.longitude !== null;
  if (hasLat !== hasLng) {
    throw new Error("Place coordinates must include both latitude and longitude");
  }
  if (hasLat && (!isValidLatitude(input.latitude!) || !isValidLongitude(input.longitude!))) {
    throw new Error("Place requires a finite latitude [-90, 90] and longitude [-180, 180]");
  }
  const address = input.address?.trim() || undefined;
  const notes = input.notes?.trim();
  const frontmatter: OkfFrontmatter = {
    type: PLACE_TYPE,
    title,
    address,
    ...provenanceFields(input),
  };
  if (hasLat) {
    frontmatter.latitude = input.latitude;
    frontmatter.longitude = input.longitude;
    frontmatter.source = input.source;
  }
  return {
    id: conceptId(entityPlacePath(input.slug)),
    path: entityPlacePath(input.slug),
    frontmatter,
    body: notes
      ? `${notes}\n`
      : `Place on this machine. Path is identity. Map tiles and address search may use the public internet. The record stays on disk.\n`,
  };
}

export function createPlaceNoteDocument(input: {
  slug: string;
  noteSlug: string;
  title: string;
  body: string;
} & OkfCreateProvenance): OkfDocument {
  return {
    id: conceptId(placeNotePath(input.slug, input.noteSlug)),
    path: placeNotePath(input.slug, input.noteSlug),
    frontmatter: {
      type: NOTE_TYPE,
      title: input.title,
      ...provenanceFields(input),
    },
    body: `${input.body.trim()}\n\nSee [${input.slug}](/${entityPlacePath(input.slug)}).\n`,
  };
}

export function createPlaceFileDocument(input: {
  slug: string;
  fileName: string;
  title?: string;
} & OkfCreateProvenance): OkfDocument {
  const fileName = sanitizeFileName(input.fileName);
  const fileStem = fileName.replace(/\.[^.]+$/, "");
  const resource = `/${placeFilePath(input.slug, fileName)}`;
  return {
    id: conceptId(placeFileConceptPath(input.slug, fileStem)),
    path: placeFileConceptPath(input.slug, fileStem),
    frontmatter: {
      type: PLACE_FILE_TYPE,
      title: input.title ?? fileName,
      resource,
      ...provenanceFields(input),
    },
    body: `File stored beside this Place at \`${resource}\`. Not inlined as a markdown blob.\n\nPlace: [${input.slug}](/${entityPlacePath(input.slug)}).\n`,
  };
}

export function createPlaceLinksDocument(input: {
  slug: string;
  links?: OkfPlaceLink[];
} & OkfCreateProvenance): OkfDocument {
  const links = normalizePlaceLinkList(input.links);
  return {
    id: conceptId(placeLinksPath(input.slug)),
    path: placeLinksPath(input.slug),
    frontmatter: {
      type: PLACE_LINKS_TYPE,
      title: "Places",
      links,
      ...provenanceFields(input),
    },
    body: `Typed links from [${input.slug}](/${personPath(input.slug)}) to local Places (lives, works, met-at). File path is identity. Never uploaded.\n`,
  };
}

export function createDocumentDocument(input: {
  docSlug: string;
  fileName: string;
  title: string;
  kind?: string;
  note?: string;
  subjectSlugs: string[];
  placeSlugs?: string[];
} & OkfCreateProvenance): OkfDocument {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Document requires title");
  }
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) {
    throw new Error("Document requires a file");
  }
  const subjects = [
    ...new Set([
      ...input.subjectSlugs.map((slug) => personPath(slug)),
      ...(input.placeSlugs ?? []).map((slug) => entityPlacePath(slug)),
    ]),
  ];
  if (subjects.length === 0) {
    throw new Error("Document must link to at least one person or place");
  }
  const resource = `/${documentFilePath(input.docSlug, fileName)}`;
  const kind = input.kind?.trim() || DOCUMENT_KIND;
  const note = input.note?.trim();
  const links = subjects
    .map((path) => {
      const person = slugFromPersonPath(path);
      const place = slugFromPlacePath(path);
      const slug = person ?? place ?? path;
      return `- [${slug}](/${path})`;
    })
    .join("\n");
  const parts = [
    note,
    `Document file stored beside this concept at \`${resource}\`. Not inlined as a markdown blob.`,
    `Subjects:\n${links}`,
  ].filter((part): part is string => Boolean(part));
  return {
    id: conceptId(documentConceptPath(input.docSlug)),
    path: documentConceptPath(input.docSlug),
    frontmatter: {
      type: DOCUMENT_TYPE,
      title,
      resource,
      kind,
      subjects,
      ...provenanceFields(input),
    },
    body: `${parts.join("\n\n")}\n`,
  };
}

export function createRelationsDocument(input: {
  slug: string;
  relations?: OkfRelation[];
} & OkfCreateProvenance): OkfDocument {
  const relations = normalizeRelationList(input.relations);
  return {
    id: conceptId(relationsPath(input.slug)),
    path: relationsPath(input.slug),
    frontmatter: {
      type: RELATIONS_TYPE,
      title: "Relations",
      relations,
      ...provenanceFields(input),
    },
    body: `Typed links from [${input.slug}](/${personPath(input.slug)}) to other local people. File path is identity. Never uploaded.\n`,
  };
}

export function slugFromPersonPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
  const match = normalized.match(/^people\/([^/]+)\/person\.md$/);
  return match?.[1];
}

export function slugFromPlacePath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
  const match = normalized.match(/^places\/([^/]+)\/place\.md$/);
  return match?.[1];
}

export function isPlaceLinkRole(value: unknown): value is PlaceLinkRole {
  return value === "lives" || value === "works" || value === "met-at";
}

export function normalizePlaceLinkRole(role: string): PlaceLinkRole | "" {
  const trimmed = role.trim().toLowerCase();
  if (trimmed === "met at" || trimmed === "met_at" || trimmed === "metat") return "met-at";
  return isPlaceLinkRole(trimmed) ? trimmed : "";
}

export function normalizePlaceLink(value: unknown): OkfPlaceLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const role = typeof raw["role"] === "string" ? normalizePlaceLinkRole(raw["role"]) : "";
  if (!role) return null;
  const place = typeof raw["place"] === "string" ? raw["place"].replace(/\\/g, "/").replace(/^\//, "").trim() : "";
  if (!slugFromPlacePath(place)) return null;
  return { role, place };
}

export function normalizePlaceLinkList(value: unknown): OkfPlaceLink[] {
  if (!Array.isArray(value)) return [];
  const out: OkfPlaceLink[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const link = normalizePlaceLink(item);
    if (!link) continue;
    const key = placeLinkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

export function placeLinkKey(link: Pick<OkfPlaceLink, "role" | "place">): string {
  return `${link.role}|${link.place}`;
}

export function placeLinksFromDocument(doc: OkfDocument): OkfPlaceLink[] {
  if (doc.frontmatter.type !== PLACE_LINKS_TYPE) return [];
  return normalizePlaceLinkList(doc.frontmatter.links);
}

export function upsertPlaceLink(links: OkfPlaceLink[], link: OkfPlaceLink): OkfPlaceLink[] {
  const next = normalizePlaceLink(link);
  if (!next) return normalizePlaceLinkList(links);
  const without = normalizePlaceLinkList(links).filter((item) => placeLinkKey(item) !== placeLinkKey(next));
  return [...without, next];
}

export function removePlaceLink(
  links: OkfPlaceLink[],
  match: { place: string; role?: PlaceLinkRole },
): OkfPlaceLink[] {
  const place = match.place.replace(/\\/g, "/").replace(/^\//, "");
  return normalizePlaceLinkList(links).filter((item) => {
    if (item.place !== place) return true;
    if (match.role && item.role !== match.role) return true;
    return false;
  });
}

export function wipePlaceLinksForPlace(links: OkfPlaceLink[], placeSlug: string): OkfPlaceLink[] {
  const path = entityPlacePath(placeSlug);
  return normalizePlaceLinkList(links).filter((item) => item.place !== path);
}

export function documentLinkedToPlace(frontmatter: OkfFrontmatter, placeSlug: string): boolean {
  return subjectPaths(frontmatter.subjects).includes(entityPlacePath(placeSlug));
}

export function addDocumentPlaceSubject(doc: OkfDocument, placeSlug: string): OkfDocument {
  const path = entityPlacePath(placeSlug);
  const current = subjectPaths(doc.frontmatter.subjects);
  if (!current.includes(path)) {
    doc.frontmatter.subjects = [...current, path];
  }
  return doc;
}

export function removeDocumentPlaceSubject(doc: OkfDocument, placeSlug: string): OkfDocument {
  const path = entityPlacePath(placeSlug);
  doc.frontmatter.subjects = subjectPaths(doc.frontmatter.subjects).filter((item) => item !== path);
  return doc;
}

export function isRelationKind(value: unknown): value is RelationKind {
  return value === "family" || value === "business" || value === "other";
}

export function presetRolesForKind(kind: RelationKind): readonly string[] {
  if (kind === "family") return FAMILY_ROLES;
  if (kind === "business") return BUSINESS_ROLES;
  return OTHER_ROLES;
}

export function normalizeRelationRole(kind: RelationKind, role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const presets = presetRolesForKind(kind);
  const preset = presets.find((item) => item === lower);
  return preset ?? trimmed;
}

export function inverseRelationRole(role: string): string {
  const lower = role.trim().toLowerCase();
  if (lower === "parent") return "child";
  if (lower === "child") return "parent";
  return role.trim();
}

export function normalizeRelation(value: unknown): OkfRelation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isRelationKind(raw["kind"])) return null;
  const role = typeof raw["role"] === "string" ? normalizeRelationRole(raw["kind"], raw["role"]) : "";
  if (!role) return null;
  const person = typeof raw["person"] === "string" ? raw["person"].replace(/\\/g, "/").replace(/^\//, "").trim() : "";
  if (!slugFromPersonPath(person)) return null;
  return { kind: raw["kind"], role, person };
}

export function normalizeRelationList(value: unknown): OkfRelation[] {
  if (!Array.isArray(value)) return [];
  const out: OkfRelation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const edge = normalizeRelation(item);
    if (!edge) continue;
    const key = relationKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

export function relationKey(edge: Pick<OkfRelation, "kind" | "role" | "person">): string {
  return `${edge.kind}|${edge.role.toLowerCase()}|${edge.person}`;
}

export function relationsFromDocument(doc: OkfDocument): OkfRelation[] {
  if (doc.frontmatter.type !== RELATIONS_TYPE) return [];
  return normalizeRelationList(doc.frontmatter.relations);
}

export function upsertRelation(relations: OkfRelation[], edge: OkfRelation): OkfRelation[] {
  const next = normalizeRelation(edge);
  if (!next) return normalizeRelationList(relations);
  const without = normalizeRelationList(relations).filter((item) => relationKey(item) !== relationKey(next));
  return [...without, next];
}

export function removeRelation(
  relations: OkfRelation[],
  match: { person: string; kind?: RelationKind; role?: string },
): OkfRelation[] {
  const person = match.person.replace(/\\/g, "/").replace(/^\//, "");
  return normalizeRelationList(relations).filter((item) => {
    if (item.person !== person) return true;
    if (match.kind && item.kind !== match.kind) return true;
    if (match.role && item.role.toLowerCase() !== match.role.trim().toLowerCase()) return true;
    return false;
  });
}

export function wipeRelationsForSlug(relations: OkfRelation[], slug: string): OkfRelation[] {
  const path = personPath(slug);
  return normalizeRelationList(relations).filter((item) => item.person !== path);
}

export function retargetRelationsForSlug(relations: OkfRelation[], fromSlug: string, toSlug: string): OkfRelation[] {
  if (fromSlug === toSlug) return normalizeRelationList(relations);
  const from = personPath(fromSlug);
  const to = personPath(toSlug);
  return normalizeRelationList(relations).map((item) => (item.person === from ? { ...item, person: to } : item));
}

export function addDocumentSubject(doc: OkfDocument, slug: string): OkfDocument {
  const path = personPath(slug);
  const current = subjectPaths(doc.frontmatter.subjects);
  if (!current.includes(path)) {
    doc.frontmatter.subjects = [...current, path];
  }
  return doc;
}

/** Drop a person from a shared document. Leaves the document on disk. */
export function removeDocumentSubject(doc: OkfDocument, slug: string): OkfDocument {
  const path = personPath(slug);
  doc.frontmatter.subjects = subjectPaths(doc.frontmatter.subjects).filter((item) => item !== path);
  return doc;
}
