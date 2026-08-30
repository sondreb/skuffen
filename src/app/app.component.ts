import { Component, computed, HostListener, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DEMO_MERGE, DEMO_SHUFFLE, isDemoMode } from "./demo-mode";
import { PeopleMapComponent, type MapPin } from "./map/people-map.component";
import type {
  FactSuggestion,
  FollowInterval,
  MergeProposal,
  NameResearchProposal,
  PersonView,
  ProviderId,
} from "./models";
import {
  followRows,
  groupPendingFacts,
  inspectableMemory,
  pendingFacts,
  toldRows,
  type PendingMemoryFact,
  type PendingMemoryGroup,
} from "./services/memory";
import { GeocodeService, type GeocodeHit } from "./services/geocode.service";
import { LAND_PLOT_KIND } from "../../packages/okf/src/index";
import { FollowService } from "./services/follow.service";
import { grokConnectionLabel } from "./services/grok-oauth";
import { IoService, isTauri } from "./services/io.service";
import { PeopleService } from "./services/people.service";
import { ProvidersService } from "./services/providers.service";
import {
  deleteMergeField,
  dismissMergeProposal,
  findDuplicateCandidates,
  mergeWritesWithoutAccept,
  planAcceptedMerge,
  proposeMerge,
  rememberDismissedPair,
  setAllMergeFieldsKept,
  setMergeFieldKept,
} from "./services/merge";
import {
  deleteProposedFact,
  dismissNameProposal,
  keepFetchedPhoto,
  normalizeInterval,
  photoFileNameFromUrl,
  planAcceptedNameProposal,
  proposeNameResearch,
  RESEARCH_NEEDS_PROVIDER,
  setAllFactsChecked,
  setFactChecked,
  showResearchEmptyState,
  writesForAcceptedSuggestion,
} from "./services/research";
import {
  applyPolishedTalkingPoints,
  buildLocalBrief,
  demoPolishTalkingPoints,
  parseEventPaste,
  writesForAcceptedBrief,
  type MeetingBrief,
  type MeetingEvent,
} from "./services/brief";
import {
  buildDailyShuffle,
  buildLocalReconnectDraft,
  dismissShuffleWrites,
  skipShuffleWrites,
  writesForAcceptedDraft,
  type ReconnectDraft,
  type ReconnectSuggestion,
} from "./services/shuffle";
import {
  CAPTURE_NEEDS_PROVIDER,
  DEMO_CAPTURE_NOTE,
  captureItemsAsSuggestions,
  captureLabel,
  deleteCaptureItem,
  dismissCaptureProposal,
  dropCaptureAudio,
  planAcceptedCapture,
  proposeCapture as makeCaptureProposal,
  resolveCaptureNoteSlug,
  setAllCaptureChecked,
  setCaptureChecked,
  showCaptureEmptyState,
  speechRecognitionAvailable,
  transcriptFromSpeechResults,
  type CaptureProposal,
  type CaptureSource,
} from "./services/capture";
import { UPDATE_WHISPER } from "./services/update";
import { UpdateService } from "./services/update.service";

type Panel =
  | "none"
  | "create"
  | "edit"
  | "providers"
  | "map"
  | "propose"
  | "merge"
  | "memory"
  | "brief"
  | "capture"
  | "shuffle";
type SpeechSession = {
  stop: () => void;
  abort?: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
};
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
  private readonly io = inject(IoService);
  readonly updates = inject(UpdateService);
  readonly updateWhisper = UPDATE_WHISPER;

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
  nameProposal: NameResearchProposal | null = null;
  researchRequestedWithoutProvider = false;
  mergeProposal: MergeProposal | null = null;
  meetingBrief: MeetingBrief | null = null;
  briefEventPaste = "";
  briefEvent: MeetingEvent = {};
  captureNote = "";
  captureProposal: CaptureProposal | null = null;
  captureRequestedWithoutProvider = false;
  shuffleSuggestions: ReconnectSuggestion[] = [];
  pickedShuffle: ReconnectSuggestion | null = null;
  reconnectDraft: ReconnectDraft | null = null;
  private skippedShuffleSlugs = new Set<string>();
  captureRecording = false;
  private captureSpeech: SpeechSession | null = null;
  readonly dismissedMerges = signal<string[]>([]);
  checkedSuggestionIds = new Set<string>();
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
  readonly grokLabel = computed(() => grokConnectionLabel(this.providers.status()));
  readonly mergeCandidates = computed(() =>
    findDuplicateCandidates(this.people.people(), this.dismissedMerges()),
  );
  readonly visibleMerge = computed(() => {
    const selected = this.people.selected();
    const candidates = this.mergeCandidates();
    if (!selected) return candidates[0] ?? null;
    return (
      candidates.find(
        (item) => item.keeper.slug === selected.slug || item.incoming.slug === selected.slug,
      ) ?? null
    );
  });
  readonly memoryRows = computed(() =>
    inspectableMemory({
      proposals: this.follow.proposals(),
      follows: this.follow.follows(),
      people: this.people.people().map((person) => ({ slug: person.slug, title: person.title })),
      memoryLog: this.follow.memoryLog(),
    }),
  );
  readonly pendingMemoryGroups = computed(() => groupPendingFacts(pendingFacts(this.memoryRows())));
  readonly followMemoryRows = computed(() => followRows(this.memoryRows()));
  readonly toldMemoryRows = computed(() => toldRows(this.memoryRows()));
  readonly researchNeedsProvider = RESEARCH_NEEDS_PROVIDER;
  readonly captureNeedsProvider = CAPTURE_NEEDS_PROVIDER;
  readonly demoCaptureNote = DEMO_CAPTURE_NOTE;

  async ngOnInit(): Promise<void> {
    await this.people.bootstrap();
    await this.providers.refresh();
    await this.follow.load();
    const settings = await this.io.getSettings();
    this.dismissedMerges.set(settings.dismissedMerges ?? []);
    if (!this.people.locked()) {
      await this.follow.start();
    }
    this.offerMergeIfNeeded(false);
  }

  ngOnDestroy(): void {
    this.stopCaptureRecording();
    this.follow.stop();
  }

  toggleLatch(): void {
    this.latchOpen = !this.latchOpen;
    if (this.latchOpen) void this.providers.refresh();
  }

  closeLatch(): void {
    this.latchOpen = false;
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.latchOpen) {
      this.closeLatch();
      return;
    }
    if (this.panel === "propose") {
      this.dismissProposal();
      return;
    }
    if (this.panel === "merge") {
      this.closeMergeSheet();
      return;
    }
    if (this.panel === "brief") {
      this.dismissBrief();
      return;
    }
    if (this.panel === "capture") {
      this.dismissCapture();
      return;
    }
    if (this.panel === "shuffle") {
      this.dismissShuffle();
      return;
    }
    if (
      this.panel === "providers" ||
      this.panel === "create" ||
      this.panel === "edit" ||
      this.panel === "map" ||
      this.panel === "memory"
    ) {
      this.panel = "none";
    }
  }

  @HostListener("document:keydown", ["$event"])
  onDocumentKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === ",") {
      event.preventDefault();
      this.latchOpen = true;
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
    this.nameProposal = null;
    this.researchRequestedWithoutProvider = false;
    this.resetLocationDraft(person);
    await this.people.select(person.slug);
    if (this.follow.suggestionsFor(person.slug).length) {
      this.fact = "suggest";
      this.checkAllVisibleSuggestions();
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
    this.nameProposal = null;
    this.resetLocationDraft(null);
    await this.people.select(null);
  }

  startCreate(): void {
    this.draft = blankDraft();
    this.showMore = false;
    this.panel = "create";
    this.latchOpen = false;
    this.fact = "none";
    this.nameProposal = null;
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
    this.offerMergeIfNeeded(true);
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

  showProposeEmpty(): boolean {
    return showResearchEmptyState({
      requested: this.researchRequestedWithoutProvider,
      demoMode: this.demoMode,
      hasProvider: Boolean(this.activeProvider()),
      busy: this.providers.busy(),
      proposalCount: this.nameProposal?.facts.length ?? 0,
    });
  }

  showSuggestEmpty(): boolean {
    return showResearchEmptyState({
      requested: this.researchRequestedWithoutProvider,
      demoMode: this.demoMode,
      hasProvider: Boolean(this.activeProvider()),
      busy: this.providers.busy(),
      proposalCount: this.visibleSuggestions().length,
    });
  }

  private gateWithoutProvider(notice: string): boolean {
    if (this.demoMode || this.activeProvider()) {
      this.researchRequestedWithoutProvider = false;
      return false;
    }
    this.notice = notice;
    this.latchOpen = true;
    this.researchRequestedWithoutProvider = true;
    return true;
  }

  async ask(): Promise<void> {
    const person = this.people.selected();
    this.fact = "suggest";
    this.notice = null;
    if (this.gateWithoutProvider("Connect Grok in Latch → Providers first.")) {
      return;
    }
    if (person) {
      await this.providers.suggest(person);
      await this.follow.storeResearch(person.slug, this.providers.suggestions(), {
        source: "ask",
        prompt: this.providers.lastPrompt() ?? undefined,
      });
      this.checkAllVisibleSuggestions();
    }
  }

  async research(): Promise<void> {
    const person = this.people.selected();
    this.fact = "suggest";
    this.notice = null;
    if (this.gateWithoutProvider("Connect Grok in Latch → Providers first.")) {
      return;
    }
    if (!person) return;
    await this.providers.research(person);
    await this.follow.storeResearch(person.slug, this.providers.suggestions(), {
      source: "research",
      prompt: this.providers.lastPrompt() ?? undefined,
    });
    this.checkAllVisibleSuggestions();
  }

  onFindEnter(): void {
    if (!this.query().trim()) return;
    if (this.filtered().length === 0) {
      void this.researchName();
    }
  }

  async researchName(): Promise<void> {
    const name = this.query().trim();
    if (!name) return;
    this.notice = null;
    this.latchOpen = false;
    this.panel = "propose";
    this.people.selected.set(null);
    this.nameProposal = null;
    if (
      this.gateWithoutProvider(
        "Connect Grok in Latch → Providers first. There is no Skuffen cloud account.",
      )
    ) {
      return;
    }
    const suggestions = await this.providers.researchName(name);
    this.nameProposal = proposeNameResearch(name, suggestions);
    await this.follow.storeResearch(
      "",
      this.nameProposal.facts.map((fact) => fact.suggestion),
      {
        source: "research",
        query: name,
        prompt: this.providers.lastPrompt() ?? undefined,
      },
    );
  }

  toggleProposalFact(id: string, checked: boolean): void {
    if (!this.nameProposal) return;
    this.nameProposal = setFactChecked(this.nameProposal, id, checked);
  }

  selectAllProposalFacts(checked: boolean): void {
    if (!this.nameProposal) return;
    this.nameProposal = setAllFactsChecked(this.nameProposal, checked);
  }

  deleteProposalFact(id: string): void {
    if (!this.nameProposal) return;
    this.nameProposal = deleteProposedFact(this.nameProposal, id);
  }

  dismissProposal(): void {
    const pending = this.nameProposal;
    this.nameProposal = null;
    this.panel = "none";
    this.notice = null;
    this.researchRequestedWithoutProvider = false;
    void dismissNameProposal();
    if (pending) {
      for (const fact of pending.facts) {
        void this.follow.rejectSuggestion(fact.id);
      }
    }
  }

  async acceptNameProposal(): Promise<void> {
    if (!this.nameProposal) return;
    const plan = planAcceptedNameProposal(this.nameProposal);
    if (!plan) return;
    const generatedBy = this.providers.actorForActive();
    const created = await this.people.createPerson({ ...plan.person, generatedBy });
    const skippedPhotos = await this.applyExtras(created.slug, plan.extras, generatedBy);
    for (const fact of this.nameProposal.facts) {
      await this.follow.acceptLocalOnly(fact.id);
    }
    this.nameProposal = null;
    this.panel = "none";
    this.query.set("");
    this.notice = skippedPhotos
      ? `${skippedPhotos} photo${skippedPhotos === 1 ? "" : "s"} could not be fetched. The rest of the card was saved.`
      : null;
  }

  proposalHasChecked(): boolean {
    return Boolean(this.nameProposal?.facts.some((fact) => fact.checked));
  }

  offerMergeIfNeeded(openSheet: boolean): void {
    const hit = this.visibleMerge();
    if (!hit) {
      if (this.panel === "merge") this.panel = "none";
      this.mergeProposal = null;
      return;
    }
    const same =
      this.mergeProposal?.keeperSlug === hit.keeper.slug &&
      this.mergeProposal?.incomingSlug === hit.incoming.slug;
    if (!same) {
      this.mergeProposal = proposeMerge(hit.keeper, hit.incoming, hit.overlaps);
    }
    mergeWritesWithoutAccept(this.mergeProposal);
    if (openSheet) {
      this.panel = "merge";
      this.fact = "none";
    }
  }

  openMergeReview(keeperSlug?: string, incomingSlug?: string): void {
    const candidates = this.mergeCandidates();
    const hit =
      keeperSlug && incomingSlug
        ? candidates.find((item) => item.keeper.slug === keeperSlug && item.incoming.slug === incomingSlug)
        : this.visibleMerge();
    if (!hit) return;
    this.mergeProposal = proposeMerge(hit.keeper, hit.incoming, hit.overlaps);
    this.panel = "merge";
    this.latchOpen = false;
    this.fact = "none";
    this.notice = null;
  }

  toggleMergeField(id: string, keep: boolean): void {
    if (!this.mergeProposal) return;
    this.mergeProposal = setMergeFieldKept(this.mergeProposal, id, keep);
  }

  selectAllMergeFields(keep: boolean): void {
    if (!this.mergeProposal) return;
    this.mergeProposal = setAllMergeFieldsKept(this.mergeProposal, keep);
  }

  deleteMergeChoice(id: string): void {
    if (!this.mergeProposal) return;
    this.mergeProposal = deleteMergeField(this.mergeProposal, id);
  }

  closeMergeSheet(): void {
    this.panel = "none";
    this.notice = null;
    void this.people.select(null);
  }

  async dismissMerge(): Promise<void> {
    if (!this.mergeProposal) {
      this.closeMergeSheet();
      return;
    }
    this.dismissedMerges.set(
      rememberDismissedPair(this.dismissedMerges(), this.mergeProposal.keeperSlug, this.mergeProposal.incomingSlug),
    );
    await this.persistDismissedMerges();
    this.mergeProposal = null;
    this.panel = "none";
    this.notice = null;
    void dismissMergeProposal();
    await this.people.select(null);
  }

  async keepBothPeople(): Promise<void> {
    await this.dismissMerge();
  }

  async acceptMerge(): Promise<void> {
    if (!this.mergeProposal) return;
    const plan = planAcceptedMerge(this.mergeProposal);
    await this.follow.retargetSlug(plan.incomingSlug, plan.keeperSlug);
    await this.follow.forgetSlug(plan.incomingSlug);
    await this.people.applyMerge(plan);
    this.mergeProposal = null;
    this.panel = "none";
    this.notice = null;
  }

  allMergeFieldsKept(): boolean {
    return Boolean(
      this.mergeProposal &&
        this.mergeProposal.fields.length > 0 &&
        this.mergeProposal.fields.every((field) => field.keep),
    );
  }

  mergeOverlapLabel(): string {
    return this.mergeProposal?.overlaps.map((item) => item.label).join(" · ") ?? "";
  }

  overlapLabels(overlaps: { label: string }[]): string {
    return overlaps.map((item) => item.label).join(" · ");
  }

  async seedDemoDuplicate(): Promise<void> {
    if (!this.demoMode) return;
    const drafts = DEMO_MERGE;
    const people = this.people.people();
    const hasKeeper = people.some((item) => item.title === drafts.keeper.title);
    if (!hasKeeper) {
      const created = await this.people.createPerson({
        title: drafts.keeper.title,
        description: drafts.keeper.description,
        email: drafts.keeper.email,
      });
      await this.people.addNote(created.slug, "Keeper slip (demo)", "Synthetic keeper card. Not a real person.");
    }
    const afterKeeper = this.people.people();
    if (afterKeeper.some((item) => item.title === drafts.incoming.title)) {
      this.offerMergeIfNeeded(true);
      return;
    }
    const twin = await this.people.createPerson({
      title: drafts.incoming.title,
      description: drafts.incoming.description,
      email: drafts.incoming.email,
    });
    await this.people.addNote(twin.slug, drafts.incoming.noteTitle, drafts.incoming.noteBody);
    this.offerMergeIfNeeded(true);
  }

  private async persistDismissedMerges(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings({ ...settings, dismissedMerges: this.dismissedMerges() });
  }

  allProposalChecked(): boolean {
    return Boolean(this.nameProposal && this.nameProposal.facts.length > 0 && this.nameProposal.facts.every((fact) => fact.checked));
  }

  suggestionLabel(item: FactSuggestion): string {
    if (item.kind === "photo") return item.url || item.title;
    if (item.kind === "field") return item.value || item.title;
    return item.body || item.value || item.url || item.title;
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
    const skipped = await this.applyExtras(person.slug, [suggestion], generatedBy);
    if (skipped) {
      this.notice = "That photo could not be fetched. Nothing else was skipped.";
    }
    this.providers.reject(suggestion.id);
    const next = new Set(this.checkedSuggestionIds);
    next.delete(suggestion.id);
    this.checkedSuggestionIds = next;
    await this.follow.acceptLocalOnly(suggestion.id);
  }

  async acceptCheckedSuggestions(): Promise<void> {
    const selected = this.visibleSuggestions().filter((item) => this.checkedSuggestionIds.has(item.id));
    for (const item of selected) {
      await this.accept(item);
    }
  }

  reject(suggestion: FactSuggestion): void {
    this.providers.reject(suggestion.id);
    const next = new Set(this.checkedSuggestionIds);
    next.delete(suggestion.id);
    this.checkedSuggestionIds = next;
    void this.follow.rejectSuggestion(suggestion.id);
  }

  toggleSuggestionCheck(id: string, checked: boolean): void {
    const next = new Set(this.checkedSuggestionIds);
    if (checked) next.add(id);
    else next.delete(id);
    this.checkedSuggestionIds = next;
  }

  selectAllVisibleSuggestions(checked: boolean): void {
    if (checked) this.checkAllVisibleSuggestions();
    else this.checkedSuggestionIds = new Set();
  }

  allVisibleSuggestionsChecked(): boolean {
    const items = this.visibleSuggestions();
    return items.length > 0 && items.every((item) => this.checkedSuggestionIds.has(item.id));
  }

  hasCheckedSuggestions(): boolean {
    return this.visibleSuggestions().some((item) => this.checkedSuggestionIds.has(item.id));
  }

  private checkAllVisibleSuggestions(): void {
    this.checkedSuggestionIds = new Set(this.visibleSuggestions().map((item) => item.id));
  }

  async clearContact(field: "email" | "phone"): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    await this.people.clearContactField(person.slug, field);
  }

  async removeSocial(path: string): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    await this.people.removeSocial(person.slug, path);
  }

  async removePhoto(photo: PersonView["photos"][number]): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    await this.people.removePhoto(person.slug, photo);
  }

  private async applyExtras(slug: string, extras: FactSuggestion[], generatedBy: string): Promise<number> {
    let skippedPhotos = 0;
    for (const extra of extras) {
      const write = writesForAcceptedSuggestion(slug, extra);
      if (write.type === "photo") {
        const stored = keepFetchedPhoto(write, await this.io.fetchPublicBytes(write.url));
        if (!stored) {
          skippedPhotos += 1;
          continue;
        }
        await this.people.addPhotoBytes(
          slug,
          photoFileNameFromUrl(write.url, `research-${Date.now().toString(36)}`),
          stored.bytes,
          write.title,
          generatedBy,
        );
      } else if (write.type === "social") {
        await this.people.addSocial(write.slug, write.network, write.url, write.handle, generatedBy);
      } else if (write.type === "field") {
        await this.people.updatePerson(write.slug, { [write.field]: write.value });
      } else {
        await this.people.addNote(write.slug, write.title, write.body, generatedBy);
      }
    }
    return skippedPhotos;
  }

  openProviders(): void {
    this.latchOpen = false;
    this.panel = "providers";
    this.people.selected.set(null);
    void this.providers.refresh();
  }

  openMemory(): void {
    this.latchOpen = false;
    this.panel = "memory";
    this.fact = "none";
    this.checkedSuggestionIds = new Set(pendingFacts(this.memoryRows()).map((item) => item.id));
  }

  async openBrief(slug?: string): Promise<void> {
    this.latchOpen = false;
    this.panel = "brief";
    this.fact = "none";
    this.notice = null;
    const target = slug || this.people.selected()?.slug;
    if (target && this.people.selected()?.slug !== target) {
      await this.people.select(target);
    }
    this.rebuildBrief();
  }

  onBriefEventPaste(text: string): void {
    this.briefEventPaste = text;
    this.briefEvent = parseEventPaste(text);
    this.rebuildBrief();
  }

  rebuildBrief(): void {
    const person = this.people.selected();
    if (!person) {
      this.meetingBrief = null;
      return;
    }
    this.meetingBrief = buildLocalBrief({
      person,
      proposals: this.follow.proposals().filter((item) => item.slug === person.slug),
      follow: this.follow.followFor(person.slug),
      event: this.briefEvent,
    });
  }

  async polishBrief(): Promise<void> {
    if (!this.meetingBrief) return;
    this.notice = null;
    if (this.demoMode) {
      this.meetingBrief = applyPolishedTalkingPoints(
        this.meetingBrief,
        demoPolishTalkingPoints(this.meetingBrief),
        false,
      );
      return;
    }
    const polished = await this.providers.polishBrief(this.meetingBrief);
    if (polished) {
      this.meetingBrief = polished;
      return;
    }
    this.notice = "Local brief is ready offline. Polish needs Grok or Gemini in Latch.";
  }

  async acceptBrief(): Promise<void> {
    if (!this.meetingBrief) return;
    const write = writesForAcceptedBrief(this.meetingBrief);
    await this.people.addNote(write.slug, write.title, write.body);
    this.meetingBrief = null;
    this.briefEventPaste = "";
    this.briefEvent = {};
    this.panel = "none";
    this.notice = null;
  }

  dismissBrief(): void {
    this.meetingBrief = null;
    this.briefEventPaste = "";
    this.briefEvent = {};
    this.panel = "none";
    this.notice = null;
  }

  openShuffle(slug?: string): void {
    this.latchOpen = false;
    this.panel = "shuffle";
    this.fact = "none";
    this.notice = null;
    this.rebuildShuffle();
    if (slug && this.shuffleSuggestions.some((item) => item.slug === slug)) {
      this.pickShuffle(slug);
    }
  }

  rebuildShuffle(): void {
    const deck = buildDailyShuffle({
      people: this.people.people().map((person) => ({
        person,
        follow: this.follow.followFor(person.slug),
      })),
      skipSlugs: this.skippedShuffleSlugs,
    });
    this.shuffleSuggestions = deck.suggestions;
    if (this.pickedShuffle && !this.shuffleSuggestions.some((item) => item.slug === this.pickedShuffle?.slug)) {
      this.pickedShuffle = null;
      this.reconnectDraft = null;
    }
  }

  pickShuffle(slug: string): void {
    const hit = this.shuffleSuggestions.find((item) => item.slug === slug);
    if (!hit) return;
    this.pickedShuffle = hit;
    this.reconnectDraft = buildLocalReconnectDraft(hit);
    this.notice = null;
    void this.people.select(slug);
  }

  skipShuffle(slug: string): void {
    skipShuffleWrites();
    this.skippedShuffleSlugs.add(slug);
    this.pickedShuffle = null;
    this.reconnectDraft = null;
    this.notice = null;
    this.rebuildShuffle();
  }

  dismissShuffle(): void {
    dismissShuffleWrites();
    this.pickedShuffle = null;
    this.reconnectDraft = null;
    this.skippedShuffleSlugs = new Set();
    this.shuffleSuggestions = [];
    this.panel = "none";
    this.notice = null;
  }

  async polishShuffleDraft(): Promise<void> {
    if (!this.pickedShuffle || !this.reconnectDraft) return;
    this.notice = null;
    const polished = await this.providers.polishReconnectDraft(this.pickedShuffle, this.reconnectDraft);
    if (polished) {
      this.reconnectDraft = polished;
      return;
    }
    this.notice = "Local draft is ready offline. Polish needs Grok or Gemini in Latch.";
  }

  async acceptShuffle(): Promise<void> {
    if (!this.reconnectDraft) return;
    const write = writesForAcceptedDraft(this.reconnectDraft);
    if (!write) return;
    await this.people.addNote(write.slug, write.title, write.body);
    this.pickedShuffle = null;
    this.reconnectDraft = null;
    this.skippedShuffleSlugs = new Set();
    this.shuffleSuggestions = [];
    this.panel = "none";
    this.notice = null;
  }

  onReconnectDraftChange(text: string): void {
    if (!this.reconnectDraft) return;
    this.reconnectDraft = { ...this.reconnectDraft, body: text };
  }

  async seedDemoShuffle(): Promise<void> {
    if (!this.demoMode) return;
    const drafts = DEMO_SHUFFLE;
    const people = this.people.people();
    if (!people.some((item) => item.title === drafts.first.title)) {
      const created = await this.people.createPerson({
        title: drafts.first.title,
        description: drafts.first.description,
        email: drafts.first.email,
      });
      await this.people.addNote(created.slug, drafts.first.noteTitle, drafts.first.noteBody);
    } else {
      const ada = this.people.people().find((item) => item.title === drafts.first.title);
      if (ada && ada.notes.length === 0) {
        await this.people.addNote(ada.slug, drafts.first.noteTitle, drafts.first.noteBody);
      }
    }
    const afterAda = this.people.people();
    if (!afterAda.some((item) => item.title === drafts.second.title)) {
      const bea = await this.people.createPerson({
        title: drafts.second.title,
        description: drafts.second.description,
        email: drafts.second.email,
      });
      await this.people.addNote(bea.slug, drafts.second.noteTitle, drafts.second.noteBody);
    } else {
      const bea = afterAda.find((item) => item.title === drafts.second.title);
      if (bea && bea.notes.length === 0) {
        await this.people.addNote(bea.slug, drafts.second.noteTitle, drafts.second.noteBody);
      }
    }
    this.skippedShuffleSlugs = new Set();
    this.openShuffle();
  }

  canRecordCapture(): boolean {
    return this.desktop && !this.demoMode && speechRecognitionAvailable();
  }

  openCapture(slug?: string): void {
    this.latchOpen = false;
    this.panel = "capture";
    this.fact = "none";
    this.notice = null;
    this.captureProposal = null;
    this.captureRequestedWithoutProvider = false;
    this.stopCaptureRecording();
    if (slug) {
      void this.people.select(slug);
    }
    if (this.demoMode && !this.captureNote.trim()) {
      this.captureNote = this.demoCaptureNote;
    }
  }

  showCaptureEmpty(): boolean {
    return showCaptureEmptyState({
      requested: this.captureRequestedWithoutProvider,
      demoMode: this.demoMode,
      hasProvider: Boolean(this.activeProvider()),
      busy: this.providers.busy(),
      proposalCount: this.captureProposal?.items.length ?? 0,
    });
  }

  async proposeCapture(): Promise<void> {
    const note = this.captureNote.trim();
    if (!note) return;
    this.notice = null;
    this.captureProposal = null;
    if (
      this.gateWithoutProvider(
        "Connect Grok in Latch → Providers first. There is no Skuffen cloud account.",
      )
    ) {
      this.captureRequestedWithoutProvider = true;
      return;
    }
    this.captureRequestedWithoutProvider = false;
    const source: CaptureSource = this.captureRecording ? "mic" : "paste";
    this.stopCaptureRecording();
    const items = await this.providers.captureNote(note);
    this.captureProposal = makeCaptureProposal(note, items, source);
    await this.follow.storeResearch(
      this.people.selected()?.slug ?? "",
      captureItemsAsSuggestions(this.captureProposal.items.map((entry) => entry.item)),
      {
        source: "capture",
        query: note.slice(0, 80),
        prompt: this.providers.lastPrompt() ?? undefined,
      },
    );
  }

  toggleCaptureItem(id: string, checked: boolean): void {
    if (!this.captureProposal) return;
    this.captureProposal = setCaptureChecked(this.captureProposal, id, checked);
  }

  selectAllCaptureItems(checked: boolean): void {
    if (!this.captureProposal) return;
    this.captureProposal = setAllCaptureChecked(this.captureProposal, checked);
  }

  deleteCaptureChoice(id: string): void {
    if (!this.captureProposal) return;
    this.captureProposal = deleteCaptureItem(this.captureProposal, id);
    void this.follow.rejectSuggestion(id);
  }

  allCaptureChecked(): boolean {
    return Boolean(
      this.captureProposal &&
        this.captureProposal.items.length > 0 &&
        this.captureProposal.items.every((item) => item.checked),
    );
  }

  captureHasChecked(): boolean {
    return Boolean(this.captureProposal?.items.some((item) => item.checked));
  }

  captureItemLabel(id: string): string {
    const item = this.captureProposal?.items.find((entry) => entry.id === id)?.item;
    return item ? captureLabel(item) : "";
  }

  async acceptCapture(): Promise<void> {
    if (!this.captureProposal) return;
    const plan = planAcceptedCapture(this.captureProposal, this.people.selected()?.title);
    if (!plan) return;
    const generatedBy = this.providers.actorForActive();
    for (const person of plan.people) {
      const existing = this.people.people().find((item) => item.title.toLowerCase() === person.title.toLowerCase());
      if (!existing) {
        await this.people.createPerson({ ...person, generatedBy });
      }
    }
    for (const note of plan.notes) {
      const slug =
        resolveCaptureNoteSlug(note.personTitle, this.people.people()) ??
        this.people.people().find((item) => item.title.toLowerCase() === note.personTitle.toLowerCase())?.slug;
      if (!slug) continue;
      await this.people.addNote(slug, note.title, note.body, generatedBy);
    }
    for (const entry of this.captureProposal.items) {
      await this.follow.acceptLocalOnly(entry.id);
    }
    this.captureProposal = null;
    this.captureNote = "";
    this.captureRequestedWithoutProvider = false;
    this.panel = "none";
    this.notice = null;
    this.stopCaptureRecording();
  }

  dismissCapture(): void {
    const pending = this.captureProposal;
    this.stopCaptureRecording();
    this.captureProposal = null;
    this.captureRequestedWithoutProvider = false;
    this.panel = "none";
    this.notice = null;
    void dismissCaptureProposal();
    if (pending) {
      for (const entry of pending.items) {
        void this.follow.rejectSuggestion(entry.id);
      }
    }
  }

  startCaptureRecording(): void {
    if (!this.canRecordCapture() || this.captureRecording) return;
    const host = globalThis as typeof globalThis & {
      SpeechRecognition?: new () => SpeechSession;
      webkitSpeechRecognition?: new () => SpeechSession;
    };
    const Ctor = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Ctor) {
      this.notice = "Mic needs a desktop WebView that can transcribe locally. Paste a note instead.";
      return;
    }
    this.notice = null;
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const spoken = transcriptFromSpeechResults(event.results);
      if (spoken) this.captureNote = spoken;
    };
    recognition.onerror = (event) => {
      this.notice = event.error === "not-allowed" ? "Mic permission denied. Paste a note instead." : "Mic stopped. Paste a note if needed.";
      this.stopCaptureRecording();
    };
    recognition.onend = () => {
      this.captureRecording = false;
      this.captureSpeech = dropCaptureAudio(this.captureSpeech);
    };
    this.captureSpeech = recognition;
    this.captureRecording = true;
    recognition.start();
  }

  stopCaptureRecording(): void {
    this.captureRecording = false;
    this.captureSpeech = dropCaptureAudio(this.captureSpeech);
  }

  async acceptMemoryFact(row: PendingMemoryFact): Promise<void> {
    if (row.slug) {
      await this.people.select(row.slug);
      await this.accept(row.suggestion);
      return;
    }
    if (!row.query) return;
    const proposal = proposeNameResearch(row.query, [row.suggestion]);
    const plan = planAcceptedNameProposal(proposal);
    if (!plan) return;
    const generatedBy = this.providers.actorForActive();
    const created = await this.people.createPerson({ ...plan.person, generatedBy });
    await this.applyExtras(created.slug, plan.extras, generatedBy);
    await this.follow.acceptLocalOnly(row.suggestion.id);
  }

  async acceptMemoryGroup(group: PendingMemoryGroup): Promise<void> {
    const selected = group.facts.filter((fact) => this.checkedSuggestionIds.has(fact.id));
    if (group.slug) {
      for (const fact of selected) {
        await this.acceptMemoryFact(fact);
      }
      this.panel = "none";
      return;
    }
    if (!group.query || selected.length === 0) return;
    const proposal = proposeNameResearch(
      group.query,
      selected.map((fact) => fact.suggestion),
    );
    const plan = planAcceptedNameProposal(proposal);
    if (!plan) return;
    const generatedBy = this.providers.actorForActive();
    const created = await this.people.createPerson({ ...plan.person, generatedBy });
    await this.applyExtras(created.slug, plan.extras, generatedBy);
    for (const fact of selected) {
      await this.follow.acceptLocalOnly(fact.id);
    }
    this.panel = "none";
  }

  async dismissMemoryGroup(group: PendingMemoryGroup): Promise<void> {
    for (const fact of group.facts) {
      this.providers.reject(fact.id);
      const next = new Set(this.checkedSuggestionIds);
      next.delete(fact.id);
      this.checkedSuggestionIds = next;
    }
    await this.follow.dismissProposal(group.proposalId);
    if (this.nameProposal?.query && this.nameProposal.query === group.query) {
      this.nameProposal = null;
    }
  }

  async unfollowFromMemory(slug: string): Promise<void> {
    await this.follow.setFollow(slug, false);
  }

  trustLabel(trust: string): string {
    return trust === "hostile-web" ? "Public web — hostile until Accept" : "Local ask";
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

  async checkForUpdate(): Promise<void> {
    await this.updates.check();
  }

  async installUpdate(): Promise<void> {
    await this.updates.install();
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

  grokChipConnected(): boolean {
    return this.providers.grokConnected();
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
