import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  DOCUMENT_TYPE,
  addDocumentSubject,
  appendLog,
  createDocumentDocument,
  createNoteDocument,
  createPersonDocument,
  createPlaceDocument,
  createSocialDocument,
  documentConceptPath,
  documentDir,
  documentFilePath,
  documentLinkedToPerson,
  emptyLog,
  locationFromDocument,
  parseDocument,
  personPath,
  placePath,
  serializeBundleIndex,
  serializeDocument,
  serializePeopleIndex,
  slugify,
  subjectPaths,
  type OkfDocument,
  type PlaceLocation,
  type PlaceSource,
} from "../../packages/okf/src/index.ts";
import { vaultKeyFromEnv } from "../../packages/okf/src/vault.ts";
import { deleteBundleFile, readBundleFile, writeBundleFile } from "../../packages/okf/src/vault-fs.ts";

export interface PersonView {
  id: string;
  slug: string;
  path: string;
  title: string;
  description?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  body: string;
  notes: Array<{ id: string; path: string; title: string; body: string }>;
  social: Array<{ id: string; path: string; title: string; network?: string; handle?: string; url?: string }>;
  photos: Array<{ id: string; path: string; title: string; resource?: string }>;
  location?: PlaceLocation;
  documents: Array<{
    id: string;
    slug: string;
    path: string;
    title: string;
    resource?: string;
    kind?: string;
    note?: string;
    subjects: string[];
  }>;
}

export function defaultBundleRoot(): string {
  if (process.env.SKUFFEN_BUNDLE) return process.env.SKUFFEN_BUNDLE;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "me.grok.skuffen", "people-graph");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "me.grok.skuffen", "people-graph");
  }
  return join(homedir(), ".local", "share", "me.grok.skuffen", "people-graph");
}

export class OkfBundle {
  private readonly vaultKey: Uint8Array | null;

  constructor(
    public readonly root: string,
    vaultKey: Uint8Array | null = vaultKeyFromEnv(),
  ) {
    this.vaultKey = vaultKey;
  }

  ensure(): void {
    mkdirSync(join(this.root, "people"), { recursive: true });
    mkdirSync(join(this.root, "documents"), { recursive: true });
    if (!this.read("index.md")) {
      this.writeRaw("index.md", serializeBundleIndex([]));
    }
    if (!this.read("log.md")) {
      this.writeRaw("log.md", emptyLog());
    }
    if (!this.read("people/index.md")) {
      this.writeRaw("people/index.md", serializePeopleIndex([]));
    }
  }

  listPeople(): PersonView[] {
    return this.listSlugs().map((slug) => this.getPerson(slug)).filter((p): p is PersonView => !!p);
  }

  searchPeople(query: string): PersonView[] {
    const q = query.toLowerCase();
    return this.listPeople().filter((person) => {
      const hay = [person.title, person.description, person.body, ...person.notes.map((n) => n.title)]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  getPerson(slug: string): PersonView | null {
    const path = personPath(slug);
    const raw = this.read(path);
    if (!raw) return null;
    const doc = parseDocument(path, raw);
    const notes = this.readDocs(`people/${slug}/notes`).map((note) => ({
      id: note.id,
      path: note.path,
      title: String(note.frontmatter.title ?? note.id),
      body: note.body,
    }));
    const social = this.readDocs(`people/${slug}/social`).map((item) => ({
      id: item.id,
      path: item.path,
      title: String(item.frontmatter.title ?? item.id),
      network: optionalString(item.frontmatter.network),
      handle: optionalString(item.frontmatter.handle),
      url: optionalString(item.frontmatter.resource),
    }));
    const photos = this.readDocs(`people/${slug}/photos`).map((item) => ({
      id: item.id,
      path: item.path,
      title: String(item.frontmatter.title ?? item.id),
      resource: optionalString(item.frontmatter.resource),
    }));
    const placeRaw = this.read(placePath(slug));
    const location = placeRaw ? locationFromDocument(parseDocument(placePath(slug), placeRaw)) ?? undefined : undefined;
    return {
      id: doc.id,
      slug,
      path: doc.path,
      title: String(doc.frontmatter.title ?? slug),
      description: optionalString(doc.frontmatter.description),
      givenName: optionalString(doc.frontmatter["given_name"]),
      familyName: optionalString(doc.frontmatter["family_name"]),
      email: optionalString(doc.frontmatter["email"]),
      phone: optionalString(doc.frontmatter["phone"]),
      body: doc.body,
      notes,
      social,
      photos,
      location,
      documents: this.documentsFor(slug),
    };
  }

  setLocation(
    slug: string,
    input: { title?: string; address?: string; latitude: number; longitude: number; source?: PlaceSource },
  ): PersonView {
    if (!this.getPerson(slug)) throw new Error(`Unknown person ${slug}`);
    const doc = createPlaceDocument({ slug, ...input });
    this.writeDoc(doc);
    this.log("Update", `Set location [${doc.frontmatter.title}](/${doc.path}).`);
    return this.getPerson(slug)!;
  }

  clearLocation(slug: string): PersonView {
    if (!this.getPerson(slug)) throw new Error(`Unknown person ${slug}`);
    const path = placePath(slug);
    deleteBundleFile(this.root, path);
    this.log("Update", `Cleared location [/${path}].`);
    return this.getPerson(slug)!;
  }

  createPerson(input: { title: string; description?: string; givenName?: string; familyName?: string }): PersonView {
    const slug = uniqueSlug(
      slugify(input.title),
      (candidate) => exists(join(this.root, personPath(candidate))),
    );
    const doc = createPersonDocument({ slug, ...input });
    this.writeDoc(doc);
    this.log("Creation", `Added [${doc.frontmatter.title}](/${doc.path}).`);
    this.rebuildIndexes();
    return this.getPerson(slug)!;
  }

  updatePerson(slug: string, patch: Partial<{ title: string; description: string; givenName: string; familyName: string; body: string }>): PersonView {
    const path = personPath(slug);
    const raw = this.read(path);
    if (!raw) throw new Error(`Unknown person ${slug}`);
    const doc = parseDocument(path, raw);
    if (patch.title !== undefined) doc.frontmatter.title = patch.title;
    if (patch.description !== undefined) doc.frontmatter.description = patch.description;
    if (patch.givenName !== undefined) doc.frontmatter.given_name = patch.givenName;
    if (patch.familyName !== undefined) doc.frontmatter.family_name = patch.familyName;
    if (patch.body !== undefined) doc.body = patch.body;
    this.writeDoc(doc);
    this.log("Update", `Updated [${doc.frontmatter.title}](/${doc.path}).`);
    this.rebuildIndexes();
    return this.getPerson(slug)!;
  }

  addNote(slug: string, title: string, body: string): PersonView {
    if (!this.getPerson(slug)) throw new Error(`Unknown person ${slug}`);
    const note = createNoteDocument({ slug, noteSlug: uniqueSlug(slugify(title), () => false), title, body });
    this.writeDoc(note);
    this.log("Creation", `Added note [${title}](/${note.path}).`);
    return this.getPerson(slug)!;
  }

  addDocument(input: {
    slug: string;
    title: string;
    filePath: string;
    fileName?: string;
    kind?: string;
    note?: string;
  }): PersonView {
    if (!this.getPerson(input.slug)) throw new Error(`Unknown person ${input.slug}`);
    const fileName = input.fileName || basename(input.filePath);
    const docSlug = uniqueSlug(slugify(input.title || fileName), (candidate) =>
      exists(join(this.root, documentDir(candidate))),
    );
    const dest = documentFilePath(docSlug, fileName);
    writeBundleFile(this.root, dest, readFileSync(input.filePath), this.vaultKey);
    const doc = createDocumentDocument({
      docSlug,
      fileName,
      title: input.title,
      kind: input.kind,
      note: input.note,
      subjectSlugs: [input.slug],
    });
    this.writeDoc(doc);
    this.log("Creation", `Added document [${doc.frontmatter.title}](/${doc.path}).`);
    return this.getPerson(input.slug)!;
  }

  linkDocument(docSlug: string, slug: string): PersonView {
    if (!this.getPerson(slug)) throw new Error(`Unknown person ${slug}`);
    const path = documentConceptPath(docSlug);
    const raw = this.read(path);
    if (!raw) throw new Error(`Unknown document ${docSlug}`);
    const doc = addDocumentSubject(parseDocument(path, raw), slug);
    this.writeDoc(doc);
    this.log("Update", `Linked [${doc.frontmatter.title}](/${doc.path}) to [${slug}](/${personPath(slug)}).`);
    return this.getPerson(slug)!;
  }

  addSocial(slug: string, network: string, url: string, handle?: string): PersonView {
    if (!this.getPerson(slug)) throw new Error(`Unknown person ${slug}`);
    const social = createSocialDocument({ slug, network, url, handle });
    this.writeDoc(social);
    this.log("Creation", `Added social profile [${social.frontmatter.title}](/${social.path}).`);
    return this.getPerson(slug)!;
  }

  recentLog(limit = 20): string[] {
    const raw = this.read("log.md") ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("* "))
      .slice(0, limit);
  }

  private documentsFor(slug: string): PersonView["documents"] {
    const dir = join(this.root, "documents");
    if (!exists(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((name) => exists(join(this.root, documentConceptPath(name))))
      .map((name) => {
        const rel = documentConceptPath(name);
        const raw = this.read(rel);
        return raw ? { name, doc: parseDocument(rel, raw) } : null;
      })
      .filter((item): item is { name: string; doc: OkfDocument } => {
        if (!item) return false;
        return item.doc.frontmatter.type === DOCUMENT_TYPE && documentLinkedToPerson(item.doc.frontmatter, slug);
      })
      .map(({ name, doc }) => ({
        id: doc.id,
        slug: name,
        path: doc.path,
        title: String(doc.frontmatter.title ?? doc.id),
        resource: optionalString(doc.frontmatter.resource),
        kind: optionalString(doc.frontmatter.kind),
        note: documentNote(doc.body),
        subjects: subjectPaths(doc.frontmatter.subjects),
      }));
  }

  private listSlugs(): string[] {
    const peopleDir = join(this.root, "people");
    if (!exists(peopleDir)) return [];
    return readdirSync(peopleDir)
      .filter((name) => statSync(join(peopleDir, name)).isDirectory())
      .filter((name) => exists(join(this.root, personPath(name))))
      .sort();
  }

  private readDocs(prefix: string): OkfDocument[] {
    const dir = join(this.root, prefix);
    if (!exists(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md") && name !== "index.md" && name !== "log.md")
      .map((name) => {
        const rel = `${prefix}/${name}`;
        return parseDocument(rel, this.read(rel)!);
      });
  }

  private read(rel: string): string | null {
    const buf = readBundleFile(this.root, rel, this.vaultKey);
    return buf ? buf.toString("utf8") : null;
  }

  private writeRaw(rel: string, contents: string): void {
    writeBundleFile(this.root, rel, Buffer.from(contents, "utf8"), this.vaultKey);
  }

  private writeDoc(doc: OkfDocument): void {
    this.writeRaw(doc.path, serializeDocument(doc));
  }

  private log(kind: string, detail: string): void {
    const current = this.read("log.md") ?? emptyLog();
    this.writeRaw("log.md", appendLog(current, kind, detail));
  }

  private rebuildIndexes(): void {
    const people = this.listPeople().map((person) => ({
      title: person.title,
      path: person.path,
      description: person.description,
    }));
    this.writeRaw("index.md", serializeBundleIndex(people));
    this.writeRaw("people/index.md", serializePeopleIndex(people));
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function documentNote(body: string): string | undefined {
  const first = body.split(/\n\n/)[0]?.trim() ?? "";
  if (!first || /stored beside this concept/.test(first) || first.startsWith("Subjects:")) {
    return undefined;
  }
  return first;
}

function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
