import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const OKF_VERSION = "0.2";
export const PERSON_TYPE = "Person";
export const NOTE_TYPE = "Note";
export const PHOTO_TYPE = "Photo";
export const SOCIAL_TYPE = "SocialProfile";
export const PLACE_TYPE = "Place";
export const DOCUMENT_TYPE = "Document";
export const DOCUMENT_KIND = "document";
export const RELATIONS_TYPE = "Relations";

export type OkfType =
  | typeof PERSON_TYPE
  | typeof NOTE_TYPE
  | typeof PHOTO_TYPE
  | typeof SOCIAL_TYPE
  | typeof PLACE_TYPE
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

export interface OkfFrontmatter {
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  generated?: OkfActorStamp;
  verified?: OkfActorStamp | OkfActorStamp[];
  status?: "draft" | "stable" | "deprecated";
  sources?: OkfSource[];
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
  const frontmatter = parsed as OkfFrontmatter;
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

export function serializeBundleIndex(entries: { title: string; path: string; description?: string }[]): string {
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

export function documentLinkedToPerson(frontmatter: OkfFrontmatter, slug: string): boolean {
  return subjectPaths(frontmatter.subjects).includes(personPath(slug));
}

export function verifiedList(value: OkfFrontmatter["verified"]): OkfActorStamp[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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
  body?: string;
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  const at = nowUtc();
  const frontmatter: OkfFrontmatter & PersonFields = {
    type: PERSON_TYPE,
    title: input.title,
    description: input.description || undefined,
    given_name: input.givenName || undefined,
    family_name: input.familyName || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
    image: personImageResource(input.image),
    generated: { by: input.generatedBy ?? actorHuman(), at },
    verified: { by: input.verifiedBy ?? actorHuman(), at },
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
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  const at = nowUtc();
  return {
    id: conceptId(notePath(input.slug, input.noteSlug)),
    path: notePath(input.slug, input.noteSlug),
    frontmatter: {
      type: NOTE_TYPE,
      title: input.title,
      generated: { by: input.generatedBy ?? actorHuman(), at },
      verified: { by: input.verifiedBy ?? actorHuman(), at },
    },
    body: `${input.body.trim()}\n\nSee [${input.slug}](/${personPath(input.slug)}).\n`,
  };
}

export function createSocialDocument(input: {
  slug: string;
  network: string;
  handle?: string;
  url: string;
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  const at = nowUtc();
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
    generated: { by: input.generatedBy ?? actorHuman(), at },
    verified: { by: input.verifiedBy ?? actorHuman(), at },
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
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  const at = nowUtc();
  const fileStem = input.fileName.replace(/\.[^.]+$/, "");
  const resource = `/${photoFilePath(input.slug, input.fileName)}`;
  return {
    id: conceptId(photoConceptPath(input.slug, fileStem)),
    path: photoConceptPath(input.slug, fileStem),
    frontmatter: {
      type: PHOTO_TYPE,
      title: input.title ?? input.fileName,
      resource,
      generated: { by: input.generatedBy ?? actorHuman(), at },
      verified: { by: input.verifiedBy ?? actorHuman(), at },
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
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) {
    throw new Error("Place requires a finite latitude [-90, 90] and longitude [-180, 180]");
  }
  const at = nowUtc();
  const address = input.address?.trim() || undefined;
  const title = input.title?.trim() || address || `${input.latitude.toFixed(5)}, ${input.longitude.toFixed(5)}`;
  const frontmatter: OkfFrontmatter & PlaceFields = {
    type: PLACE_TYPE,
    title,
    address,
    latitude: input.latitude,
    longitude: input.longitude,
    source: input.source,
    generated: { by: input.generatedBy ?? actorHuman(), at },
    verified: { by: input.verifiedBy ?? actorHuman(), at },
  };
  return {
    id: conceptId(placePath(input.slug)),
    path: placePath(input.slug),
    frontmatter,
    body: `Location for [${input.slug}](/${personPath(input.slug)}).\n\nCoordinates stay in this OKF bundle. Map tiles and address search may use the public internet.\n`,
  };
}

export function createDocumentDocument(input: {
  docSlug: string;
  fileName: string;
  title: string;
  kind?: string;
  note?: string;
  subjectSlugs: string[];
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Document requires title");
  }
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) {
    throw new Error("Document requires a file");
  }
  const subjects = [...new Set(input.subjectSlugs.map((slug) => personPath(slug)))];
  if (subjects.length === 0) {
    throw new Error("Document must link to at least one person");
  }
  const at = nowUtc();
  const resource = `/${documentFilePath(input.docSlug, fileName)}`;
  const kind = input.kind?.trim() || DOCUMENT_KIND;
  const note = input.note?.trim();
  const links = subjects
    .map((path) => {
      const slug = path.replace(/^people\//, "").replace(/\/person\.md$/, "");
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
      generated: { by: input.generatedBy ?? actorHuman(), at },
      verified: { by: input.verifiedBy ?? actorHuman(), at },
    },
    body: `${parts.join("\n\n")}\n`,
  };
}

export function createRelationsDocument(input: {
  slug: string;
  relations?: OkfRelation[];
  generatedBy?: string;
  verifiedBy?: string;
}): OkfDocument {
  const at = nowUtc();
  const relations = normalizeRelationList(input.relations);
  return {
    id: conceptId(relationsPath(input.slug)),
    path: relationsPath(input.slug),
    frontmatter: {
      type: RELATIONS_TYPE,
      title: "Relations",
      relations,
      generated: { by: input.generatedBy ?? actorHuman(), at },
      verified: { by: input.verifiedBy ?? actorHuman(), at },
    },
    body: `Typed links from [${input.slug}](/${personPath(input.slug)}) to other local people. File path is identity. Never uploaded.\n`,
  };
}

export function slugFromPersonPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
  const match = normalized.match(/^people\/([^/]+)\/person\.md$/);
  return match?.[1];
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
  if (!isRelationKind(raw.kind)) return null;
  const role = typeof raw.role === "string" ? normalizeRelationRole(raw.kind, raw.role) : "";
  if (!role) return null;
  const person = typeof raw.person === "string" ? raw.person.replace(/\\/g, "/").replace(/^\//, "").trim() : "";
  if (!slugFromPersonPath(person)) return null;
  return { kind: raw.kind, role, person };
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
