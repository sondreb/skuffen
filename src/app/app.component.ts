import { Component, computed, HostListener, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { isDemoMode } from "./demo-mode";
import { PeopleMapComponent, type MapPin } from "./map/people-map.component";
import type { FactSuggestion, FollowInterval, PersonView, ProviderId } from "./models";
import { GeocodeService, type GeocodeHit } from "./services/geocode.service";
import { LAND_PLOT_KIND } from "../../packages/okf/src/index";
import { FollowService } from "./services/follow.service";
import { isTauri } from "./services/io.service";
import { PeopleService } from "./services/people.service";
import { ProvidersService } from "./services/providers.service";
import { normalizeInterval, writesForAcceptedSuggestion } from "./services/research";

type Panel = "none" | "create" | "edit" | "providers" | "map";
type FactSurface = "none" | "drop" | "pin" | "note" | "suggest";

@Component({
  selector: "app-root",
  imports: [FormsModule, PeopleMapComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit, OnDestroy {
  readonly people = inject(PeopleService);
  readonly providers = inject(ProvidersService);
  readonly geocode = inject(GeocodeService);
  readonly follow = inject(FollowService);

  readonly query = signal("");
  panel: Panel = "none";
  fact: FactSurface = "none";
  latchOpen = false;
  showMore = false;
  addingSocial = false;
  dragging = false;
  pinDropped = false;
  notice: string | null = null;
  addressQuery = "";
  geocodeHits: GeocodeHit[] = [];
  geocodeBusy = false;
  geocodeError = "";
  pendingPin: { latitude: number; longitude: number; address?: string; source: "search" | "pin" } | null = null;
  mapFocus: { latitude: number; longitude: number; zoom?: number } | null = null;
  mapAssignSlug = "";
  draft = blankDraft();
  noteTitle = "";
  noteBody = "";
  socialNetwork = "";
  socialHandle = "";
  socialUrl = "";
  docTitle = "";
  docNote = "";
  docKind: "document" | typeof LAND_PLOT_KIND = "document";
  linkSlug = "";
  grokKey = "";
  geminiKey = "";
  readonly desktop = isTauri();
  readonly landPlotKind = LAND_PLOT_KIND;
  readonly demoMode = isDemoMode();

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.people.people();
    if (!q) return all;
    return all.filter((person) => `${person.title} ${person.description ?? ""}`.toLowerCase().includes(q));
  });

  readonly empty = computed(() => this.people.ready() && !this.people.locked() && this.people.people().length === 0);
  readonly browsing = computed(
    () => this.people.ready() && !this.people.locked() && this.panel === "none" && !this.people.selected() && this.people.people().length > 0,
  );
  readonly activeProvider = computed(() => this.providers.activeProvider());
  readonly bothProviders = computed(() => this.providers.availableProviders().length === 2);
  readonly inDrawer = computed(() => this.people.people().length);
  readonly mapPins = computed<MapPin[]>(() =>
    this.people
      .people()
      .filter((person): person is PersonView & { location: NonNullable<PersonView["location"]> } => !!person.location)
      .map((person) => ({ slug: person.slug, title: person.title, location: person.location })),
  );
  readonly mapAssignPeople = computed(() => this.people.people());
  readonly visibleSuggestions = computed(() => {
    const slug = this.people.selected()?.slug;
    const live = this.providers.suggestions();
    const stored = slug ? this.follow.suggestionsFor(slug) : [];
    const seen = new Set<string>();
    const out: FactSuggestion[] = [];
    for (const item of [...live, ...stored]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  });
  readonly selectedFollow = computed(() => {
    const slug = this.people.selected()?.slug;
    return slug ? this.follow.followFor(slug) : null;
  });

  async ngOnInit(): Promise<void> {
    await this.people.bootstrap();
    await this.providers.refresh();
    await this.follow.load();
    if (!this.people.locked()) {
      await this.follow.start();
    }
  }

  ngOnDestroy(): void {
    this.follow.stop();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.latchOpen) {
      this.latchOpen = false;
      return;
    }
    if (this.panel === "providers" || this.panel === "create" || this.panel === "edit" || this.panel === "map") {
      this.panel = "none";
    }
  }

  async open(person: PersonView): Promise<void> {
    this.panel = "none";
    this.latchOpen = false;
    this.fact = "none";
    this.notice = null;
    this.pinDropped = false;
    this.addingSocial = false;
    this.providers.clearSuggestions();
    this.resetLocationDraft(person);
    await this.people.select(person.slug);
    if (this.follow.suggestionsFor(person.slug).length) {
      this.fact = "suggest";
    }
  }

  async openBySlug(slug: string): Promise<void> {
    const person = this.people.people().find((item) => item.slug === slug);
    if (person) await this.open(person);
  }

  openMap(): void {
    this.latchOpen = false;
    this.panel = "map";
    this.fact = "none";
    this.mapAssignSlug = this.people.selected()?.slug ?? "";
    this.resetLocationDraft(this.people.selected());
  }

  async closeFile(): Promise<void> {
    this.panel = "none";
    this.fact = "none";
    this.notice = null;
    this.pinDropped = false;
    this.addingSocial = false;
    this.providers.clearSuggestions();
    this.resetLocationDraft(null);
    await this.people.select(null);
  }

  startCreate(): void {
    this.draft = blankDraft();
    this.showMore = false;
    this.panel = "create";
    this.latchOpen = false;
    this.fact = "none";
    this.people.selected.set(null);
    this.resetLocationDraft(null);
  }

  startEdit(): void {
    const person = this.people.selected();
    if (!person) return;
    this.draft = {
      title: person.title,
      description: person.description ?? "",
      givenName: person.givenName ?? "",
      familyName: person.familyName ?? "",
      email: person.email ?? "",
      phone: person.phone ?? "",
      body: person.body,
    };
    this.showMore = true;
    this.panel = "edit";
  }

  async saveDraft(): Promise<void> {
    if (!this.draft.title.trim()) return;
    if (this.panel === "create") {
      await this.people.createPerson({ ...this.draft });
    } else if (this.panel === "edit" && this.people.selected()) {
      await this.people.updatePerson(this.people.selected()!.slug, { ...this.draft });
    }
    this.panel = "none";
    this.fact = "none";
  }

  setFact(next: FactSurface): void {
    this.fact = this.fact === next ? "none" : next;
    this.notice = null;
    if (this.fact === "pin") {
      this.resetLocationDraft(this.people.selected());
    }
  }

  async addNote(): Promise<void> {
    const person = this.people.selected();
    const body = this.noteBody.trim();
    if (!person || !body) return;
    const title = this.noteTitle.trim() || body.split(/\n/)[0].slice(0, 48);
    await this.people.addNote(person.slug, title, body);
    this.noteTitle = "";
    this.noteBody = "";
  }

  async addSocial(): Promise<void> {
    const person = this.people.selected();
    if (!person || !this.socialNetwork.trim() || !this.socialUrl.trim()) return;
    await this.people.addSocial(person.slug, this.socialNetwork.trim(), this.socialUrl.trim(), this.socialHandle.trim() || undefined);
    this.socialNetwork = "";
    this.socialHandle = "";
    this.socialUrl = "";
    this.addingSocial = false;
  }

  async addPhoto(): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    if (!this.desktop) {
      this.notice = "Photos need the desktop shell.";
      return;
    }
    const source = await this.people.pickPhoto();
    if (!source) return;
    await this.people.addPhoto(person.slug, source);
    this.notice = null;
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    if (!this.people.selected() && !this.browsing()) return;
    event.preventDefault();
    this.dragging = true;
    if (this.people.selected()) this.fact = "drop";
  }

  onDragLeave(event: DragEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as Node).contains(next)) return;
    this.dragging = false;
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging = false;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    const person = this.people.selected();
    if (!person) return;
    await this.ingestFiles(Array.from(files), person.slug);
  }

  onCardDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
  }

  async onDropOnPerson(event: DragEvent, person: PersonView): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = false;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    await this.people.select(person.slug);
    await this.ingestFiles(Array.from(files), person.slug);
  }

  async ingestFiles(files: File[], slug: string): Promise<void> {
    this.fact = "drop";
    const images = files.filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name));
    const docs = files.filter((file) => !images.includes(file));

    if (docs.length) {
      await this.attachFiles(slug, docs, this.docKind);
    }

    if (images.length) {
      if (!this.desktop) {
        await this.attachFiles(slug, images, this.docKind);
      } else {
        let wrote = 0;
        for (const file of images) {
          const path = (file as File & { path?: string }).path;
          if (!path) continue;
          await this.people.addPhoto(slug, path);
          wrote += 1;
        }
        if (!wrote) {
          await this.attachFiles(slug, images, this.docKind);
        }
      }
    }

    this.notice = null;
  }

  async searchAddress(): Promise<void> {
    const q = this.addressQuery.trim();
    if (!q) return;
    this.geocodeBusy = true;
    this.geocodeError = "";
    this.notice = null;
    try {
      this.geocodeHits = await this.geocode.search(q);
      if (this.geocodeHits.length === 0) {
        this.geocodeError = "No addresses matched. Try a more specific query.";
      }
    } catch (error) {
      this.geocodeHits = [];
      this.geocodeError = error instanceof Error ? error.message : String(error);
    } finally {
      this.geocodeBusy = false;
    }
  }

  pickGeocodeHit(hit: GeocodeHit): void {
    this.pendingPin = {
      latitude: hit.latitude,
      longitude: hit.longitude,
      address: hit.label,
      source: "search",
    };
    this.pinDropped = true;
    this.mapFocus = { latitude: hit.latitude, longitude: hit.longitude, zoom: 14 };
    this.addressQuery = hit.label;
    this.geocodeHits = [];
  }

  async onMapDrop(coords: { latitude: number; longitude: number }): Promise<void> {
    this.pendingPin = { ...coords, source: "pin" };
    this.pinDropped = true;
    this.mapFocus = { ...coords, zoom: 14 };
    this.geocodeError = "";
    this.notice = null;
    try {
      const hit = await this.geocode.reverse(coords.latitude, coords.longitude);
      if (hit && this.pendingPin?.source === "pin") {
        this.pendingPin = { ...this.pendingPin, address: hit.label };
      }
    } catch {
      /* reverse geocode is optional; the pin still stays local */
    }
  }

  async savePendingLocation(slug?: string): Promise<void> {
    const target = slug || this.mapAssignSlug || this.people.selected()?.slug;
    if (!target || !this.pendingPin) return;
    await this.people.setLocation(target, {
      title: this.pendingPin.address,
      address: this.pendingPin.address,
      latitude: this.pendingPin.latitude,
      longitude: this.pendingPin.longitude,
      source: this.pendingPin.source,
    });
    this.pendingPin = null;
    this.geocodeHits = [];
    this.pinDropped = true;
    this.notice = null;
  }

  async clearPersonLocation(): Promise<void> {
    const person = this.people.selected();
    if (!person?.location) return;
    await this.people.clearLocation(person.slug);
    this.resetLocationDraft(null);
    this.pinDropped = false;
  }

  private resetLocationDraft(person: PersonView | null): void {
    this.addressQuery = person?.location?.address ?? "";
    this.geocodeHits = [];
    this.geocodeError = "";
    this.pendingPin = null;
    this.pinDropped = Boolean(person?.location);
    this.mapFocus = person?.location
      ? { latitude: person.location.latitude, longitude: person.location.longitude, zoom: 13 }
      : null;
  }

  async pickAndAddDocument(kind?: string): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    if (kind) this.docKind = kind === LAND_PLOT_KIND ? LAND_PLOT_KIND : "document";
    const chosenKind = this.docKind;
    if (this.desktop) {
      const source = await this.people.pickDocument();
      if (!source) return;
      const fileName = source.split(/[\\/]/).pop() || `document-${Date.now()}`;
      await this.people.addDocument(person.slug, {
        fileName,
        sourcePath: source,
        title: this.docTitle.trim() || stem(fileName),
        kind: chosenKind,
        note: this.docNote.trim() || undefined,
      });
      this.clearDocDraft();
      return;
    }
    document.getElementById("skuffen-document-file")?.click();
  }

  async onDocumentFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    const person = this.people.selected();
    if (person && files?.length) {
      await this.attachFiles(person.slug, files, this.docKind);
    }
    input.value = "";
  }

  async attachFiles(slug: string, files: FileList | File[], kind: string): Promise<void> {
    for (const file of Array.from(files)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.people.addDocument(slug, {
        fileName: file.name,
        bytes,
        title: this.docTitle.trim() || stem(file.name),
        kind,
        note: this.docNote.trim() || undefined,
      });
    }
    this.clearDocDraft();
  }

  async linkSelectedDocument(docSlug: string): Promise<void> {
    if (!this.linkSlug) return;
    await this.people.linkDocument(docSlug, this.linkSlug);
    this.linkSlug = "";
  }

  unlinkedPeople(doc: PersonView["documents"][number]): PersonView[] {
    return this.people.people().filter((item) => !doc.subjects.includes(`people/${item.slug}/person.md`));
  }

  kindLabel(kind?: string): string {
    return kind === LAND_PLOT_KIND ? "Land plot" : "Document";
  }

  private clearDocDraft(): void {
    this.docTitle = "";
    this.docNote = "";
    this.docKind = "document";
  }

  async ask(): Promise<void> {
    const person = this.people.selected();
    this.fact = "suggest";
    this.notice = null;
    if (!this.activeProvider()) {
      this.notice = "Connect Grok or Gemini in the latch first.";
      return;
    }
    if (person) await this.providers.suggest(person);
  }

  async research(): Promise<void> {
    const person = this.people.selected();
    this.fact = "suggest";
    this.notice = null;
    if (this.demoMode) {
      if (!person) return;
      await this.providers.applyDemoResearch();
      await this.follow.storeResearch(person.slug, this.providers.suggestions());
      return;
    }
    if (!this.activeProvider()) {
      this.notice = "Connect Grok or Gemini in the latch first.";
      return;
    }
    if (!person) return;
    await this.providers.research(person);
    await this.follow.storeResearch(person.slug, this.providers.suggestions());
  }

  async toggleFollow(enabled: boolean): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    const interval = this.selectedFollow()?.interval ?? "weekly";
    await this.follow.setFollow(person.slug, enabled, interval);
  }

  async setFollowInterval(interval: FollowInterval): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    await this.follow.setFollow(person.slug, true, normalizeInterval(interval));
  }

  async accept(suggestion: FactSuggestion): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    const generatedBy = this.providers.actorForActive();
    const write = writesForAcceptedSuggestion(person.slug, suggestion);
    if (write.type === "social") {
      await this.people.addSocial(write.slug, write.network, write.url, write.handle, generatedBy);
    } else if (write.type === "field") {
      await this.people.updatePerson(write.slug, { [write.field]: write.value });
    } else {
      await this.people.addNote(write.slug, write.title, write.body, generatedBy);
    }
    this.providers.reject(suggestion.id);
    await this.follow.acceptLocalOnly(suggestion.id);
  }

  reject(suggestion: FactSuggestion): void {
    this.providers.reject(suggestion.id);
    void this.follow.rejectSuggestion(suggestion.id);
  }

  openProviders(): void {
    this.latchOpen = false;
    this.panel = "providers";
    this.people.selected.set(null);
  }

  async unlock(): Promise<void> {
    await this.people.unlock();
    if (!this.people.locked()) {
      await this.follow.start();
    }
  }

  async lock(): Promise<void> {
    this.follow.stop();
    await this.people.lock();
    this.panel = "none";
    this.latchOpen = false;
    this.fact = "none";
  }

  async exportPlain(): Promise<void> {
    await this.people.exportPlain();
  }

  async chooseProvider(provider: ProviderId): Promise<void> {
    await this.providers.setPreferred(provider);
  }

  async saveGrokKey(): Promise<void> {
    if (this.grokKey.trim()) {
      await this.providers.saveGrokApiKey(this.grokKey);
      this.grokKey = "";
    }
  }

  async saveGeminiKey(): Promise<void> {
    if (this.geminiKey.trim()) {
      await this.providers.saveGeminiApiKey(this.geminiKey);
      this.geminiKey = "";
    }
  }

  hasAbout(person: PersonView): boolean {
    const body = person.body.trim();
    if (!body) return false;
    return body !== `# About\n\nNotes and social links for ${person.title} live beside this document.`;
  }

  initials(title: string): string {
    return title
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }

  providerLabel(): string {
    return this.activeProvider() === "gemini" ? "Gemini" : "Grok";
  }
}

function blankDraft() {
  return {
    title: "",
    description: "",
    givenName: "",
    familyName: "",
    email: "",
    phone: "",
    body: "",
  };
}

function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || fileName;
}
