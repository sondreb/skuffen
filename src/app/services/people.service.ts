import { Injectable, signal } from "@angular/core";
import {
  DOCUMENT_TYPE,
  addDocumentSubject,
  appendLog,
  createDocumentDocument,
  createNoteDocument,
  createPersonDocument,
  createPhotoDocument,
  createPlaceDocument,
  createSocialDocument,
  documentConceptPath,
  documentFilePath,
  documentLinkedToPerson,
  emptyLog,
  locationFromDocument,
  parseDocument,
  personDir,
  personPath,
  photoFilePath,
  placePath,
  sanitizeFileName,
  serializeBundleIndex,
  serializeDocument,
  serializePeopleIndex,
  slugify,
  subjectPaths,
  verifiedList,
  type OkfDocument,
  type OkfFrontmatter,
  type PlaceSource,
} from "../../../packages/okf/src/index";
import type { PersonLocation, PersonView } from "../models";
import { localPhotoBundlePath, localPhotoDataUrl, personListPhotoUrl } from "../list-photo";
import type { MergePlan } from "./merge";
import { IoService } from "./io.service";

@Injectable({ providedIn: "root" })
export class PeopleService {
  readonly people = signal<PersonView[]>([]);
  readonly selected = signal<PersonView | null>(null);
  readonly bundleRoot = signal<string>("");
  readonly ready = signal(false);
  readonly locked = signal(false);
  readonly encryptionAvailable = signal(false);
  readonly vaultMessage = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor(private readonly io: IoService) {}

  async bootstrap(): Promise<void> {
    const vault = await this.io.unlockVault();
    this.encryptionAvailable.set(vault.available);
    this.vaultMessage.set(vault.message ?? null);
    if (!vault.unlocked && vault.available) {
      this.locked.set(true);
      this.people.set([]);
      this.selected.set(null);
      this.ready.set(true);
      this.error.set(vault.message ?? "Unlock the people-graph with your OS credentials.");
      return;
    }
    this.locked.set(false);
    const settings = await this.io.getSettings();
    const root = await this.io.ensureBundle(settings.bundleRoot);
    if (settings.bundleRoot !== root) {
      await this.io.saveSettings({ ...settings, bundleRoot: root });
    }
    this.bundleRoot.set(root);
    const after = await this.io.vaultStatus();
    this.vaultMessage.set(after.message ?? vault.message ?? null);
    this.encryptionAvailable.set(after.available);
    await this.reload();
    this.ready.set(true);
  }

  async lock(): Promise<void> {
    const status = await this.io.lockVault();
    this.locked.set(true);
    this.people.set([]);
    this.selected.set(null);
    this.vaultMessage.set(status.message ?? "People-graph locked.");
  }

  async unlock(): Promise<void> {
    this.error.set(null);
    await this.bootstrap();
  }

  async exportPlain(): Promise<void> {
    const dest = await this.io.exportPlainOkf(this.bundleRoot() || "localStorage://skuffen-people-graph");
    if (dest) {
      this.vaultMessage.set(
        dest.startsWith("download:")
          ? "Downloaded a plaintext JSON export of the browser preview. Desktop export writes a real OKF folder."
          : `Exported plaintext OKF to ${dest}. That folder is readable — keep it off cloud drives.`,
      );
    }
  }

  async chooseFolder(): Promise<void> {
    const picked = await this.io.pickFolder();
    if (!picked) return;
    const root = await this.io.ensureBundle(picked);
    const settings = await this.io.getSettings();
    await this.io.saveSettings({ ...settings, bundleRoot: root });
    this.bundleRoot.set(root);
    await this.reload();
  }

  async reload(): Promise<void> {
    const root = this.bundleRoot();
    const files = await this.io.listFiles(root, "people/");
    const slugs = [
      ...new Set(
        files
          .filter((path) => path.endsWith("/person.md"))
          .map((path) => path.slice("people/".length, -"/person.md".length)),
      ),
    ].sort();
    const people: PersonView[] = [];
    for (const slug of slugs) {
      const person = await this.loadPerson(slug);
      if (person) people.push(person);
    }
    this.people.set(people);
    const current = this.selected();
    this.selected.set(current ? people.find((p) => p.slug === current.slug) ?? null : null);
  }

  async select(slug: string | null): Promise<void> {
    if (!slug) {
      this.selected.set(null);
      return;
    }
    const cached = this.people().find((item) => item.slug === slug);
    if (cached) this.selected.set(cached);
    const fresh = await this.loadPerson(slug);
    if (fresh) this.selected.set(fresh);
  }

  async createPerson(input: {
    title: string;
    description?: string;
    givenName?: string;
    familyName?: string;
    email?: string;
    phone?: string;
    body?: string;
    generatedBy?: string;
  }): Promise<PersonView> {
    const slug = await this.uniqueSlug(slugify(input.title));
    const { generatedBy, ...fields } = input;
    const doc = createPersonDocument({ slug, ...fields, generatedBy });
    await this.writeDoc(doc);
    await this.log("Creation", `Added [${doc.frontmatter.title}](/${doc.path}).`);
    await this.reload();
    await this.rebuildIndexes();
    const created = this.people().find((p) => p.slug === slug)!;
    this.selected.set(created);
    return created;
  }

  async updatePerson(
    slug: string,
    patch: Partial<{
      title: string;
      description: string;
      givenName: string;
      familyName: string;
      email: string;
      phone: string;
      body: string;
    }>,
  ): Promise<void> {
    const path = personPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) throw new Error("Person not found");
    const doc = parseDocument(path, raw);
    if (patch.title !== undefined) doc.frontmatter.title = patch.title;
    if (patch.description !== undefined) doc.frontmatter.description = patch.description;
    if (patch.givenName !== undefined) doc.frontmatter.given_name = patch.givenName;
    if (patch.familyName !== undefined) doc.frontmatter.family_name = patch.familyName;
    if (patch.email !== undefined) doc.frontmatter.email = patch.email || undefined;
    if (patch.phone !== undefined) doc.frontmatter.phone = patch.phone || undefined;
    if (patch.body !== undefined) doc.body = patch.body;
    await this.writeDoc(doc);
    await this.log("Update", `Updated [${doc.frontmatter.title}](/${doc.path}).`);
    await this.reload();
    await this.rebuildIndexes();
    await this.select(slug);
  }

  async addNote(slug: string, title: string, body: string, generatedBy?: string): Promise<void> {
    const doc = createNoteDocument({
      slug,
      noteSlug: slugify(title) + "-" + Date.now().toString(36),
      title,
      body,
      generatedBy,
      verifiedBy: generatedBy ? undefined : undefined,
    });
    if (generatedBy) {
      doc.frontmatter.verified = { by: "human:user", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    }
    await this.writeDoc(doc);
    await this.log("Creation", `Added note [${title}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async addSocial(slug: string, network: string, url: string, handle?: string, generatedBy?: string): Promise<void> {
    const doc = createSocialDocument({ slug, network, url, handle, generatedBy });
    if (generatedBy) {
      doc.frontmatter.verified = { by: "human:user", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    }
    await this.writeDoc(doc);
    await this.log("Creation", `Added social profile [${doc.frontmatter.title}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async pickPhoto(): Promise<string | null> {
    return this.io.pickImageFile();
  }

  async setLocation(
    slug: string,
    input: {
      title?: string;
      address?: string;
      latitude: number;
      longitude: number;
      source?: PlaceSource;
    },
  ): Promise<void> {
    const doc = createPlaceDocument({ slug, ...input });
    await this.writeDoc(doc);
    await this.log("Update", `Set location [${doc.frontmatter.title}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async clearLocation(slug: string): Promise<void> {
    const path = placePath(slug);
    await this.io.deleteFile(this.bundleRoot(), path);
    await this.log("Update", `Cleared location [/${path}].`);
    await this.reload();
    await this.select(slug);
  }

  async pickDocument(): Promise<string | null> {
    return this.io.pickDocumentFile();
  }

  async addPhoto(slug: string, sourcePath: string): Promise<void> {
    const fileName = sourcePath.split(/[\\/]/).pop() || `photo-${Date.now()}.jpg`;
    const dest = photoFilePath(slug, fileName);
    await this.io.copyFileIntoBundle(this.bundleRoot(), sourcePath, dest);
    const doc = createPhotoDocument({ slug, fileName });
    await this.writeDoc(doc);
    await this.log("Creation", `Added photo [${fileName}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async addPhotoBytes(
    slug: string,
    fileName: string,
    bytes: Uint8Array,
    title?: string,
    generatedBy?: string,
  ): Promise<void> {
    const safe = await this.uniquePhotoFileName(slug, sanitizeFileName(fileName));
    const dest = photoFilePath(slug, safe);
    await this.io.writeBytes(this.bundleRoot(), dest, bytes);
    const doc = createPhotoDocument({ slug, fileName: safe, title, generatedBy });
    if (generatedBy) {
      doc.frontmatter.verified = { by: "human:user", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    }
    await this.writeDoc(doc);
    await this.log("Creation", `Added photo [${safe}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async removeSocial(slug: string, path: string): Promise<void> {
    await this.io.deleteFile(this.bundleRoot(), path);
    await this.log("Update", `Removed social profile [/${path}].`);
    await this.reload();
    await this.select(slug);
  }

  async removePhoto(slug: string, photo: { path: string; resource?: string }): Promise<void> {
    await this.io.deleteFile(this.bundleRoot(), photo.path);
    const file = photo.resource?.replace(/^\//, "");
    if (file) await this.io.deleteFile(this.bundleRoot(), file);
    await this.log("Update", `Removed photo [/${photo.path}].`);
    await this.reload();
    await this.select(slug);
  }

  async clearContactField(slug: string, field: "email" | "phone"): Promise<void> {
    await this.updatePerson(slug, { [field]: "" });
  }

  async addDocument(
    slug: string,
    input: {
      fileName: string;
      title: string;
      kind?: string;
      note?: string;
      bytes?: Uint8Array;
      sourcePath?: string;
    },
  ): Promise<void> {
    const docSlug = await this.uniqueDocSlug(slugify(input.title || input.fileName));
    const dest = documentFilePath(docSlug, input.fileName);
    if (input.bytes) {
      await this.io.writeBytes(this.bundleRoot(), dest, input.bytes);
    } else if (input.sourcePath) {
      await this.io.copyFileIntoBundle(this.bundleRoot(), input.sourcePath, dest);
    } else {
      throw new Error("Document needs file bytes or a local path");
    }
    const doc = createDocumentDocument({
      docSlug,
      fileName: input.fileName,
      title: input.title,
      kind: input.kind || "document",
      note: input.note,
      subjectSlugs: [slug],
    });
    await this.writeDoc(doc);
    await this.log("Creation", `Added document [${doc.frontmatter.title}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async linkDocument(docSlug: string, slug: string): Promise<void> {
    const path = documentConceptPath(docSlug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) throw new Error("Document not found");
    const doc = addDocumentSubject(parseDocument(path, raw), slug);
    await this.writeDoc(doc);
    await this.log("Update", `Linked [${doc.frontmatter.title}](/${doc.path}) to [${slug}](/${personPath(slug)}).`);
    await this.reload();
    await this.select(slug);
  }

  /**
   * Apply an accepted merge plan. Detection and review never call this.
   * The incoming person folder is removed only here.
   */
  async applyMerge(plan: MergePlan): Promise<PersonView> {
    if (plan.keeperSlug === plan.incomingSlug) {
      throw new Error("Cannot merge a person into itself");
    }
    const keeper = this.people().find((item) => item.slug === plan.keeperSlug);
    const incoming = this.people().find((item) => item.slug === plan.incomingSlug);
    if (!keeper || !incoming) throw new Error("Merge needs both person cards");

    if (Object.keys(plan.fields).length) {
      const path = personPath(plan.keeperSlug);
      const raw = await this.io.readText(this.bundleRoot(), path);
      if (!raw) throw new Error("Person not found");
      const doc = parseDocument(path, raw);
      const patch = plan.fields;
      if (patch.title !== undefined) doc.frontmatter.title = patch.title;
      if (patch.description !== undefined) doc.frontmatter.description = patch.description;
      if (patch.givenName !== undefined) doc.frontmatter.given_name = patch.givenName;
      if (patch.familyName !== undefined) doc.frontmatter.family_name = patch.familyName;
      if (patch.email !== undefined) doc.frontmatter.email = patch.email || undefined;
      if (patch.phone !== undefined) doc.frontmatter.phone = patch.phone || undefined;
      if (patch.body !== undefined) doc.body = patch.body;
      await this.writeDoc(doc);
    }

    for (const note of plan.notes) {
      const doc = createNoteDocument({
        slug: plan.keeperSlug,
        noteSlug: `${slugify(note.title)}-${Date.now().toString(36)}`,
        title: note.title,
        body: note.body,
        generatedBy: "human:user",
      });
      await this.writeDoc(doc);
    }

    const takenSocial = new Set(
      (await this.io.listFiles(this.bundleRoot(), `people/${plan.keeperSlug}/social/`)).map((path) =>
        path.slice(`people/${plan.keeperSlug}/social/`.length, -".md".length),
      ),
    );
    for (const item of plan.social) {
      let network = item.network || "web";
      let networkSlug = slugify(network);
      if (takenSocial.has(networkSlug)) {
        network = `${network} (merged)`;
        networkSlug = slugify(network);
        let n = 2;
        while (takenSocial.has(networkSlug)) {
          network = `${item.network || "web"} (merged ${n})`;
          networkSlug = slugify(network);
          n += 1;
        }
      }
      takenSocial.add(networkSlug);
      const doc = createSocialDocument({
        slug: plan.keeperSlug,
        network,
        url: item.url,
        handle: item.handle,
        generatedBy: "human:user",
      });
      doc.frontmatter.verified = { by: "human:user", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
      await this.writeDoc(doc);
    }

    for (const photo of plan.photos) {
      const file = photo.resource?.replace(/^\//, "");
      if (!file) continue;
      const bytes = await this.io.readBytes(this.bundleRoot(), file);
      if (!bytes || bytes.byteLength === 0) continue;
      const fileName = file.split("/").pop() || `merged-${Date.now()}.jpg`;
      const safe = await this.uniquePhotoFileName(plan.keeperSlug, sanitizeFileName(fileName));
      const dest = photoFilePath(plan.keeperSlug, safe);
      await this.io.writeBytes(this.bundleRoot(), dest, bytes);
      const doc = createPhotoDocument({
        slug: plan.keeperSlug,
        fileName: safe,
        title: photo.title,
        generatedBy: "human:user",
      });
      doc.frontmatter.verified = { by: "human:user", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
      await this.writeDoc(doc);
    }

    if (plan.place) {
      const doc = createPlaceDocument({
        slug: plan.keeperSlug,
        title: plan.place.title,
        address: plan.place.address,
        latitude: plan.place.latitude,
        longitude: plan.place.longitude,
        source: (plan.place.source as PlaceSource | undefined) ?? "pin",
      });
      await this.writeDoc(doc);
    }

    for (const document of plan.documents) {
      await this.retargetDocument(document.slug, plan.incomingSlug, plan.keeperSlug);
    }
    await this.retargetRemainingDocuments(plan.incomingSlug, plan.keeperSlug);

    await this.deletePersonFolder(plan.incomingSlug);
    await this.log(
      "Update",
      `Merged [${incoming.title}](/${personPath(plan.incomingSlug)}) into [${keeper.title}](/${personPath(plan.keeperSlug)}).`,
    );
    await this.reload();
    await this.rebuildIndexes();
    await this.select(plan.keeperSlug);
    const merged = this.people().find((item) => item.slug === plan.keeperSlug);
    if (!merged) throw new Error("Merged person missing after Accept");
    return merged;
  }

  private async retargetDocument(docSlug: string, fromSlug: string, toSlug: string): Promise<void> {
    const path = documentConceptPath(docSlug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) return;
    const doc = addDocumentSubject(parseDocument(path, raw), toSlug);
    const from = personPath(fromSlug);
    doc.frontmatter.subjects = subjectPaths(doc.frontmatter.subjects).filter((item) => item !== from);
    if ((doc.frontmatter.subjects ?? []).length === 0) {
      doc.frontmatter.subjects = [personPath(toSlug)];
    }
    await this.writeDoc(doc);
  }

  private async retargetRemainingDocuments(fromSlug: string, toSlug: string): Promise<void> {
    const files = await this.io.listFiles(this.bundleRoot(), "documents/");
    for (const file of files) {
      if (!file.endsWith("/document.md")) continue;
      const text = await this.io.readText(this.bundleRoot(), file);
      if (!text) continue;
      const item = parseDocument(file, text);
      if (item.frontmatter.type !== DOCUMENT_TYPE) continue;
      if (!documentLinkedToPerson(item.frontmatter, fromSlug)) continue;
      const docSlug = file.slice("documents/".length, -"/document.md".length);
      await this.retargetDocument(docSlug, fromSlug, toSlug);
    }
  }

  private async deletePersonFolder(slug: string): Promise<void> {
    const prefix = `${personDir(slug)}/`;
    const files = await this.io.listFiles(this.bundleRoot(), prefix);
    for (const file of files) {
      await this.io.deleteFile(this.bundleRoot(), file);
    }
  }

  private async loadPerson(slug: string): Promise<PersonView | null> {
    const path = personPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) return null;
    const doc = parseDocument(path, raw);
    const files = await this.io.listFiles(this.bundleRoot(), `people/${slug}/`);
    const notes = [];
    const social = [];
    const photos = [];
    let location: PersonLocation | undefined;
    for (const file of files) {
      if (!file.endsWith(".md") || file.endsWith("/person.md")) continue;
      const text = await this.io.readText(this.bundleRoot(), file);
      if (!text) continue;
      const item = parseDocument(file, text);
      if (item.frontmatter.type === "Place") {
        const pin = locationFromDocument(item);
        location = pin ? { ...pin, at: documentDatedAt(item.frontmatter) } : undefined;
      } else if (item.frontmatter.type === "Note") {
        notes.push({
          id: item.id,
          path: item.path,
          title: String(item.frontmatter.title ?? item.id),
          body: item.body,
          at: documentDatedAt(item.frontmatter),
        });
      } else if (item.frontmatter.type === "SocialProfile") {
        social.push({
          id: item.id,
          path: item.path,
          title: String(item.frontmatter.title ?? item.id),
          network: optionalString(item.frontmatter.network),
          handle: optionalString(item.frontmatter.handle),
          url: optionalString(item.frontmatter.resource),
        });
      } else if (item.frontmatter.type === "Photo") {
        const resource = optionalString(item.frontmatter.resource);
        photos.push({
          id: item.id,
          path: item.path,
          title: String(item.frontmatter.title ?? item.id),
          resource,
          at: documentDatedAt(item.frontmatter),
          listSrc: await this.localListPhotoSrc(resource),
        });
      }
    }
    return {
      id: doc.id,
      slug,
      path: doc.path,
      title: String(doc.frontmatter.title ?? slug),
      description: optionalString(doc.frontmatter.description),
      givenName: optionalString(doc.frontmatter.given_name),
      familyName: optionalString(doc.frontmatter.family_name),
      email: optionalString(doc.frontmatter.email),
      phone: optionalString(doc.frontmatter.phone),
      body: doc.body,
      notes,
      social,
      photos,
      location,
      documents: await this.loadDocumentsForPerson(slug),
    };
  }

  private async loadDocumentsForPerson(slug: string): Promise<PersonView["documents"]> {
    const files = await this.io.listFiles(this.bundleRoot(), "documents/");
    const documents: PersonView["documents"] = [];
    for (const file of files) {
      if (!file.endsWith("/document.md")) continue;
      const text = await this.io.readText(this.bundleRoot(), file);
      if (!text) continue;
      const item = parseDocument(file, text);
      if (item.frontmatter.type !== DOCUMENT_TYPE) continue;
      if (!documentLinkedToPerson(item.frontmatter, slug)) continue;
      const docSlug = file.slice("documents/".length, -"/document.md".length);
      documents.push({
        id: item.id,
        slug: docSlug,
        path: item.path,
        title: String(item.frontmatter.title ?? item.id),
        resource: optionalString(item.frontmatter.resource),
        kind: optionalString(item.frontmatter.kind),
        note: documentNote(item.body),
        subjects: subjectPaths(item.frontmatter.subjects),
        at: documentDatedAt(item.frontmatter),
      });
    }
    return documents;
  }

  private async uniqueDocSlug(base: string): Promise<string> {
    const files = await this.io.listFiles(this.bundleRoot(), "documents/");
    const taken = new Set(
      files
        .filter((path) => path.endsWith("/document.md"))
        .map((path) => path.slice("documents/".length, -"/document.md".length)),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  /** List avatar from OKF bytes on disk. Never fetchPublicBytes / http(s). */
  private async localListPhotoSrc(resource?: string): Promise<string | undefined> {
    const local = personListPhotoUrl(resource);
    if (local) return local;
    const path = localPhotoBundlePath(resource);
    if (!path) return undefined;
    const bytes = await this.io.readBytes(this.bundleRoot(), path);
    if (!bytes) return undefined;
    return localPhotoDataUrl(bytes, path) ?? undefined;
  }

  private async uniquePhotoFileName(slug: string, fileName: string): Promise<string> {
    const files = await this.io.listFiles(this.bundleRoot(), `people/${slug}/photos/`);
    const dest = photoFilePath(slug, fileName);
    if (!files.includes(dest)) return fileName;
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
      const candidate = `${stem}-${i}${ext}`;
      if (!files.includes(photoFilePath(slug, candidate))) return candidate;
    }
    return `${stem}-${Date.now()}${ext}`;
  }

  private async uniqueSlug(base: string): Promise<string> {
    const files = await this.io.listFiles(this.bundleRoot(), "people/");
    const taken = new Set(
      files.filter((path) => path.endsWith("/person.md")).map((path) => path.slice("people/".length, -"/person.md".length)),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private async writeDoc(doc: OkfDocument): Promise<void> {
    await this.io.writeText(this.bundleRoot(), doc.path, serializeDocument(doc));
  }

  private async log(kind: string, detail: string): Promise<void> {
    const current = (await this.io.readText(this.bundleRoot(), "log.md")) ?? emptyLog();
    await this.io.writeText(this.bundleRoot(), "log.md", appendLog(current, kind, detail));
  }

  private async rebuildIndexes(): Promise<void> {
    const people = this.people();
    const entries = people.map((person) => ({
      title: person.title,
      path: person.path,
      description: person.description,
    }));
    await this.io.writeText(this.bundleRoot(), "index.md", serializeBundleIndex(entries));
    await this.io.writeText(this.bundleRoot(), "people/index.md", serializePeopleIndex(entries));
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function documentDatedAt(frontmatter: OkfFrontmatter): string | undefined {
  const stamps = verifiedList(frontmatter.verified);
  const last = stamps.length ? stamps[stamps.length - 1]?.at : undefined;
  if (typeof last === "string" && last.trim()) return last.trim();
  const generated = frontmatter.generated?.at;
  return typeof generated === "string" && generated.trim() ? generated.trim() : undefined;
}

function documentNote(body: string): string | undefined {
  const first = body.split(/\n\n/)[0]?.trim() ?? "";
  if (!first || /stored beside this concept/.test(first) || first.startsWith("Subjects:")) {
    return undefined;
  }
  return first;
}
