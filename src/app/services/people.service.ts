import { Injectable, signal } from "@angular/core";
import {
  DOCUMENT_KIND,
  DOCUMENT_TYPE,
  addDocumentSubject,
  appendLog,
  removeDocumentSubject,
  createDocumentDocument,
  createNoteDocument,
  createPersonDocument,
  createPhotoDocument,
  createPlaceDocument,
  createRelationsDocument,
  createSocialDocument,
  documentConceptPath,
  documentFilePath,
  documentLinkedToPerson,
  emptyLog,
  inverseRelationRole,
  locationFromDocument,
  normalizeRelationRole,
  parseDocument,
  personDir,
  personImageResource,
  personPath,
  photoFilePath,
  placePath,
  relationsFromDocument,
  relationsPath,
  removeRelation,
  retargetRelationsForSlug,
  sanitizeFileName,
  serializeBundleIndex,
  serializeDocument,
  serializePeopleIndex,
  slugFromPersonPath,
  slugify,
  subjectPaths,
  upsertRelation,
  verifiedList,
  wipeRelationsForSlug,
  type OkfDocument,
  type OkfFrontmatter,
  type OkfRelation,
  type PlaceSource,
  type RelationKind,
} from "../../../packages/okf/src/index";
import type { PersonLocation, PersonRelation, PersonView } from "../models";
import { localPhotoBundlePath, localPhotoDataUrl, personListPhotoUrl } from "../list-photo";
import type { MergePlan } from "./merge";
import { IoService } from "./io.service";
import { resolveRelationTitles } from "./relations";

@Injectable({ providedIn: "root" })
export class PeopleService {
  readonly people = signal<PersonView[]>([]);
  readonly selected = signal<PersonView | null>(null);
  readonly bundleRoot = signal<string>("");
  readonly ready = signal(false);
  readonly leftoverCiphertext = signal(false);
  readonly vaultMessage = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor(private readonly io: IoService) {}

  async bootstrap(): Promise<void> {
    this.error.set(null);
    const settings = await this.io.getSettings();
    const root = await this.io.ensureBundle(settings.bundleRoot);
    if (settings.bundleRoot !== root) {
      await this.io.saveSettings({ ...settings, bundleRoot: root });
    }
    this.bundleRoot.set(root);
    await this.reload();
    await this.refreshVaultStatus();
    this.ready.set(true);
  }

  private async refreshVaultStatus(): Promise<void> {
    const status = await this.io.vaultStatus();
    this.vaultMessage.set(status.message ?? null);
    this.leftoverCiphertext.set(status.encrypted);
  }

  async exportPlain(): Promise<void> {
    const dest = await this.io.exportPlainOkf(this.bundleRoot() || "localStorage://skuffen-people-graph");
    if (dest) {
      this.vaultMessage.set(
        dest.startsWith("download:")
          ? "Downloaded a plaintext JSON export of the browser preview. Desktop export writes a real OKF folder."
          : `Exported OKF folder to ${dest}. That folder is readable markdown+YAML.`,
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
    await this.refreshVaultStatus();
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
      try {
        const person = await this.loadPerson(slug);
        if (person) people.push(person);
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
    }
    const titled = resolveRelationTitles(people);
    this.people.set(titled);
    const current = this.selected();
    this.selected.set(current ? titled.find((p) => p.slug === current.slug) ?? null : null);
    await this.refreshVaultStatus();
  }

  async select(slug: string | null): Promise<void> {
    if (!slug) {
      this.selected.set(null);
      return;
    }
    const cached = this.people().find((item) => item.slug === slug);
    if (cached) this.selected.set(cached);
    const fresh = await this.loadPerson(slug);
    if (fresh) {
      const pool = this.people().some((person) => person.slug === slug)
        ? this.people().map((person) => (person.slug === slug ? fresh : person))
        : [...this.people(), fresh];
      const titled = resolveRelationTitles(pool);
      this.selected.set(titled.find((person) => person.slug === slug) ?? fresh);
    }
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
    const fileName = await this.uniquePhotoFileName(
      slug,
      sanitizeFileName(sourcePath.split(/[\\/]/).pop() || `photo-${Date.now()}.jpg`),
    );
    const dest = photoFilePath(slug, fileName);
    await this.io.copyFileIntoBundle(this.bundleRoot(), sourcePath, dest);
    const doc = createPhotoDocument({ slug, fileName });
    await this.writeDoc(doc);
    await this.log("Creation", `Added photo [${fileName}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  async setProfileImage(
    slug: string,
    input: {
      sourcePath?: string;
      bytes?: Uint8Array;
      fileName?: string;
      title?: string;
      generatedBy?: string;
    },
  ): Promise<void> {
    let resource: string | undefined;
    if (input.sourcePath) {
      const fileName = await this.uniquePhotoFileName(
        slug,
        sanitizeFileName(input.sourcePath.split(/[\\/]/).pop() || `photo-${Date.now()}.jpg`),
      );
      const dest = photoFilePath(slug, fileName);
      await this.io.copyFileIntoBundle(this.bundleRoot(), input.sourcePath, dest);
      const doc = createPhotoDocument({
        slug,
        fileName,
        title: input.title,
        generatedBy: input.generatedBy,
      });
      await this.writeDoc(doc);
      resource = `/${dest}`;
      await this.log("Creation", `Added photo [${fileName}](/${doc.path}).`);
    } else if (input.bytes && input.fileName) {
      const safe = await this.uniquePhotoFileName(slug, sanitizeFileName(input.fileName));
      const dest = photoFilePath(slug, safe);
      await this.io.writeBytes(this.bundleRoot(), dest, input.bytes);
      const doc = createPhotoDocument({
        slug,
        fileName: safe,
        title: input.title,
        generatedBy: input.generatedBy,
      });
      if (input.generatedBy) {
        doc.frontmatter.verified = {
          by: "human:user",
          at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        };
      }
      await this.writeDoc(doc);
      resource = `/${dest}`;
      await this.log("Creation", `Added photo [${safe}](/${doc.path}).`);
    } else {
      throw new Error("Profile image needs a local file");
    }
    await this.writePersonImage(slug, resource);
    await this.log("Update", `Set profile image [/${resource?.replace(/^\//, "")}].`);
    await this.reload();
    await this.select(slug);
  }

  async setProfileFromPhoto(slug: string, photo: { resource?: string }): Promise<void> {
    const resource = personImageResource(photo.resource);
    if (!resource) throw new Error("Profile image must be a local OKF file");
    await this.writePersonImage(slug, resource);
    await this.log("Update", `Set profile image [${resource}].`);
    await this.reload();
    await this.select(slug);
  }

  async addPhotoBytes(
    slug: string,
    fileName: string,
    bytes: Uint8Array,
    title?: string,
    generatedBy?: string,
    options?: { asProfileIfEmpty?: boolean },
  ): Promise<void> {
    const safe = await this.uniquePhotoFileName(slug, sanitizeFileName(fileName));
    const dest = photoFilePath(slug, safe);
    await this.io.writeBytes(this.bundleRoot(), dest, bytes);
    const doc = createPhotoDocument({ slug, fileName: safe, title, generatedBy });
    if (generatedBy) {
      doc.frontmatter.verified = { by: "human:user", at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    }
    await this.writeDoc(doc);
    const resource = `/${dest}`;
    if (options?.asProfileIfEmpty) {
      await this.setProfileIfEmpty(slug, resource);
    }
    await this.log("Creation", `Added photo [${safe}](/${doc.path}).`);
    await this.reload();
    await this.select(slug);
  }

  /** First accepted photo becomes the list profile when the card has none. */
  private async setProfileIfEmpty(slug: string, resource: string): Promise<void> {
    const path = personPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) return;
    const doc = parseDocument(path, raw);
    if (personImageResource(doc.frontmatter.image)) return;
    const local = personImageResource(resource);
    if (!local) return;
    doc.frontmatter.image = local;
    await this.writeDoc(doc);
    await this.log("Update", `Set profile image [${local}].`);
  }

  async readPhotoBytes(resource?: string): Promise<Uint8Array | null> {
    const path = localPhotoBundlePath(resource);
    if (!path) return null;
    const bytes = await this.io.readBytes(this.bundleRoot(), path);
    return bytes && bytes.byteLength > 0 ? bytes : null;
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
    await this.clearPersonImageIfMatches(slug, photo.resource);
    await this.log("Update", `Removed photo [/${photo.path}].`);
    await this.reload();
    await this.select(slug);
  }

  async clearContactField(slug: string, field: "email" | "phone"): Promise<void> {
    await this.updatePerson(slug, { [field]: "" });
  }

  /**
   * Delete a person from the local graph. Confirm in the UI first.
   * Removes the person folder, unlinks them from shared documents, and
   * drops the card from the in-memory list. Does not upload anything.
   */
  async deletePerson(slug: string): Promise<void> {
    const person = this.people().find((item) => item.slug === slug);
    const title = person?.title ?? slug;
    await this.unlinkPersonFromDocuments(slug);
    await this.wipeRelationsForSlug(slug);
    await this.deletePersonFolder(slug);
    await this.log("Update", `Deleted [${title}](/${personPath(slug)}).`);
    if (this.selected()?.slug === slug) this.selected.set(null);
    await this.reload();
    await this.rebuildIndexes();
  }

  async addRelation(
    slug: string,
    input: { relatedSlug: string; kind: RelationKind; role: string },
  ): Promise<void> {
    const relatedSlug = input.relatedSlug.trim();
    if (!relatedSlug || relatedSlug === slug) throw new Error("Pick another local person");
    const other = this.people().find((item) => item.slug === relatedSlug);
    if (!other) throw new Error("That person is not in this local graph");
    const role = normalizeRelationRole(input.kind, input.role);
    if (!role) throw new Error("Pick a relation role");
    const forward: OkfRelation = { kind: input.kind, role, person: personPath(relatedSlug) };
    const back: OkfRelation = {
      kind: input.kind,
      role: inverseRelationRole(role),
      person: personPath(slug),
    };
    await this.writeRelations(slug, upsertRelation(await this.readRelations(slug), forward));
    await this.writeRelations(relatedSlug, upsertRelation(await this.readRelations(relatedSlug), back));
    await this.log(
      "Update",
      `Linked [${slug}](/${personPath(slug)}) as ${role} of [${relatedSlug}](/${personPath(relatedSlug)}).`,
    );
    await this.reload();
    await this.select(slug);
  }

  async removeRelation(
    slug: string,
    input: { relatedSlug: string; kind: RelationKind; role: string },
  ): Promise<void> {
    const relatedSlug = input.relatedSlug.trim();
    const role = normalizeRelationRole(input.kind, input.role);
    await this.writeRelations(
      slug,
      removeRelation(await this.readRelations(slug), {
        person: personPath(relatedSlug),
        kind: input.kind,
        role,
      }),
    );
    await this.writeRelations(
      relatedSlug,
      removeRelation(await this.readRelations(relatedSlug), {
        person: personPath(slug),
        kind: input.kind,
        role: inverseRelationRole(role),
      }),
    );
    await this.log("Update", `Removed relation [${relatedSlug}](/${personPath(relatedSlug)}).`);
    await this.reload();
    await this.select(slug);
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
      kind: input.kind?.trim() || DOCUMENT_KIND,
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
    await this.retargetRelations(plan.incomingSlug, plan.keeperSlug);

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

  private async unlinkPersonFromDocuments(slug: string): Promise<void> {
    const files = await this.io.listFiles(this.bundleRoot(), "documents/");
    for (const file of files) {
      if (!file.endsWith("/document.md")) continue;
      const text = await this.io.readText(this.bundleRoot(), file);
      if (!text) continue;
      const item = parseDocument(file, text);
      if (item.frontmatter.type !== DOCUMENT_TYPE) continue;
      if (!documentLinkedToPerson(item.frontmatter, slug)) continue;
      const next = removeDocumentSubject(item, slug);
      await this.writeDoc(next);
    }
  }

  /** Wipe every file under people/{slug}/ — person.md, profile image, gallery photos, notes, place, local files. */
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
      if (!file.endsWith(".md") || file.endsWith("/person.md") || file.endsWith("/relations.md")) continue;
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
    const image = personImageResource(doc.frontmatter.image);
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
      image,
      imageSrc: image ? await this.localListPhotoSrc(image) : undefined,
      body: doc.body,
      notes,
      social,
      photos,
      location,
      documents: await this.loadDocumentsForPerson(slug),
      relations: await this.loadRelationsForPerson(slug),
    };
  }

  private async loadRelationsForPerson(slug: string): Promise<PersonRelation[]> {
    const path = relationsPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) return [];
    const doc = parseDocument(path, raw);
    return relationsFromDocument(doc)
      .map((edge) => {
        const other = slugFromPersonPath(edge.person);
        if (!other || other === slug) return null;
        return {
          kind: edge.kind,
          role: edge.role,
          slug: other,
          path: edge.person,
          title: this.people().find((person) => person.slug === other)?.title ?? other,
        };
      })
      .filter((item): item is PersonRelation => item !== null);
  }

  private async readRelations(slug: string): Promise<OkfRelation[]> {
    const path = relationsPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) return [];
    return relationsFromDocument(parseDocument(path, raw));
  }

  private async writeRelations(slug: string, relations: OkfRelation[]): Promise<void> {
    const path = relationsPath(slug);
    if (relations.length === 0) {
      await this.io.deleteFile(this.bundleRoot(), path);
      return;
    }
    await this.writeDoc(createRelationsDocument({ slug, relations }));
  }

  private async wipeRelationsForSlug(slug: string): Promise<void> {
    for (const person of this.people()) {
      if (person.slug === slug) continue;
      const next = wipeRelationsForSlug(await this.readRelations(person.slug), slug);
      await this.writeRelations(person.slug, next);
    }
  }

  private async retargetRelations(fromSlug: string, toSlug: string): Promise<void> {
    const incoming = await this.readRelations(fromSlug);
    let keeper = retargetRelationsForSlug(await this.readRelations(toSlug), fromSlug, toSlug).filter(
      (edge) => slugFromPersonPath(edge.person) !== toSlug,
    );
    for (const edge of incoming) {
      const other = slugFromPersonPath(edge.person);
      if (!other || other === toSlug || other === fromSlug) continue;
      keeper = upsertRelation(keeper, { ...edge, person: personPath(other) });
    }
    await this.writeRelations(toSlug, keeper);
    for (const person of this.people()) {
      if (person.slug === fromSlug || person.slug === toSlug) continue;
      const next = retargetRelationsForSlug(await this.readRelations(person.slug), fromSlug, toSlug);
      await this.writeRelations(person.slug, next);
    }
  }

  private async writePersonImage(slug: string, resource?: string): Promise<void> {
    const path = personPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) throw new Error("Person not found");
    const doc = parseDocument(path, raw);
    const local = personImageResource(resource);
    if (local) doc.frontmatter.image = local;
    else delete doc.frontmatter.image;
    await this.writeDoc(doc);
  }

  private async clearPersonImageIfMatches(slug: string, resource?: string): Promise<void> {
    const path = personPath(slug);
    const raw = await this.io.readText(this.bundleRoot(), path);
    if (!raw) return;
    const doc = parseDocument(path, raw);
    const current = personImageResource(doc.frontmatter.image);
    const removed = personImageResource(resource);
    if (!current || !removed || current !== removed) return;
    delete doc.frontmatter.image;
    await this.writeDoc(doc);
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
