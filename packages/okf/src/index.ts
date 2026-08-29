import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const OKF_VERSION = "0.2";
export const PERSON_TYPE = "Person";
export const NOTE_TYPE = "Note";
export const PHOTO_TYPE = "Photo";
export const SOCIAL_TYPE = "SocialProfile";

export type OkfType = typeof PERSON_TYPE | typeof NOTE_TYPE | typeof PHOTO_TYPE | typeof SOCIAL_TYPE | string;

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
