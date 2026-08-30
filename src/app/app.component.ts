import {
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DEMO_COMMITMENTS, DEMO_MERGE, DEMO_SHUFFLE, isDemoMode } from "./demo-mode";
import { ImagePreviewComponent } from "./image-preview.component";
import { type ImagePreview, previewImageSrc } from "./image-preview";
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
import { DOCUMENT_KIND } from "../../packages/okf/src/index";
import { FollowService } from "./services/follow.service";
import { grokConnectionLabel } from "./services/grok-oauth";
import { IoService, isTauri } from "./services/io.service";
import { SelfService } from "./services/self.service";
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
import { personListPhotoUrl } from "./list-photo";
import {
  DIORAMA_MENU_LABEL,
  DIORAMA_NEEDS_GROK,
  DIORAMA_NEEDS_PHOTO,
  DIORAMA_PHOTO_TITLE,
  DIORAMA_PROGRESS,
  extensionForMime,
  sniffImageMime,
} from "./services/imagine";
import {
  deleteProposedFact,
  dismissNameProposal,
  keepFetchedPhoto,
  nameAcceptErrorMessage,
  normalizeInterval,
  photoFileNameFromUrl,
  photoPreviewUrl,
  planAcceptedNameProposal,
  proposeNameResearch,
  readPublicPhotoBytes,
  RESEARCH_NEEDS_PROVIDER,
  setAllFactsChecked,
  setFactChecked,
  showResearchEmptyState,
  skippedPhotosNotice,
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
  TIMELINE_EMPTY,
  buildPersonTimeline,
  timelineOpenWrites,
  type TimelineEvent,
} from "./services/timeline";
import {
  COMMITMENTS_EMPTY,
  buildCommitmentList,
  commitmentTitle,
  commitmentsOpenWrites,
  dismissCommitmentWrites,
  dropCommitmentWrites,
  proposeCommitmentWrites,
  proposeCommitmentsFromAcceptedNotes,
  proposeCommitmentsFromText,
  rememberDroppedCommitment,
  setAllCommitmentsChecked,
  setCommitmentChecked,
  commitmentNoteBody,
  writesForAcceptedCommitments,
  writesForDoneCommitment,
  type CommitmentProposal,
  type CommitmentRow,
} from "./services/commitments";
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
  | "delete"
  | "memory"
  | "brief"
  | "capture"
  | "shuffle"
  | "commitments";

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
type FactSurface = "none" | "drop" | "pin" | "note" | "suggest" | "timeline" | "commitments";

@Component({
  selector: "app-root",
  imports: [FormsModule, PeopleMapComponent, ImagePreviewComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit, OnDestroy {
  readonly people = inject(PeopleService);
  readonly providers = inject(ProvidersService);
  readonly geocode = inject(GeocodeService);
  readonly follow = inject(FollowService);
  readonly self = inject(SelfService);
  private readonly io = inject(IoService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly updates = inject(UpdateService);
  readonly updateWhisper = UPDATE_WHISPER;
  private readonly findInput = viewChild<ElementRef<HTMLInputElement>>("findInput");
  private readonly menuSheet = viewChild<ElementRef<HTMLElement>>("menuSheet");
  private readonly menuBtn = viewChild<ElementRef<HTMLButtonElement>>("menuBtn");
  private readonly captureField = viewChild<ElementRef<HTMLTextAreaElement>>("captureField");
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>("nameField");

  readonly query = signal("");
  /** Signal-backed so `@if (panel === "create")` and `browsing` stay in sync after Add person. */
  private readonly panelState = signal<Panel>("none");
  get panel(): Panel {
    return this.panelState();
  }
  set panel(value: Panel) {
    this.panelState.set(value);
  }
  fact: FactSurface = "none";
  menuOpen = false;
  personMenu: { slug: string; x: number; y: number } | null = null;
  imagePreview: ImagePreview | null = null;
  dioramaBusy = false;
  readonly dioramaMenuLabel = DIORAMA_MENU_LABEL;
  showMore = false;
  addingSocial = false;
  dragging = false;
  pinDropped = false;
  notice: string | null = null;
  actionError: string | null = null;
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
  linkSlug = "";
  grokKey = "";
  geminiKey = "";
  nameProposal: NameResearchProposal | null = null;
  researchRequestedWithoutProvider = false;
  mergeProposal: MergeProposal | null = null;
  pendingDelete: PersonView | null = null;
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
  commitmentProposal: CommitmentProposal | null = null;
  commitmentSourceNote = "";
  captureRecording = false;
  private captureSpeech: SpeechSession | null = null;
  readonly dismissedMerges = signal<string[]>([]);
  readonly droppedCommitments = signal<string[]>([]);
  checkedSuggestionIds = new Set<string>();
  readonly desktop = isTauri();
  readonly demoMode = isDemoMode();

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.people.people();
    if (!q) return all;
    return all.filter((person) => `${person.title} ${person.description ?? ""}`.toLowerCase().includes(q));
  });

  readonly empty = computed(() => this.people.ready() && this.people.people().length === 0);
  readonly browsing = computed(
    () =>
      this.people.ready() &&
      this.panelState() === "none" &&
      !this.people.selected() &&
      this.people.people().length > 0,
  );
  readonly activeProvider = computed(() => this.providers.activeProvider());
  readonly bothProviders = computed(() => this.providers.availableProviders().length === 2);
  readonly personCount = computed(() => this.people.people().length);
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
  readonly timelineEmpty = TIMELINE_EMPTY;
  readonly commitmentsEmpty = COMMITMENTS_EMPTY;
  readonly allCommitments = computed(() =>
    buildCommitmentList({
      people: this.people.people(),
      droppedIds: this.droppedCommitments(),
    }),
  );
  readonly selectedCommitments = computed(() => {
    const person = this.people.selected();
    if (!person) return [];
    return buildCommitmentList({
      people: [person],
      droppedIds: this.droppedCommitments(),
    });
  });
  readonly selectedTimeline = computed(() => {
    const person = this.people.selected();
    if (!person) return [];
    return buildPersonTimeline({
      person,
      follow: this.follow.followFor(person.slug),
    });
  });

  async ngOnInit(): Promise<void> {
    await this.people.bootstrap();
    await this.providers.refresh();
    await this.follow.load();
    await this.self.load();
    const settings = await this.io.getSettings();
    this.dismissedMerges.set(settings.dismissedMerges ?? []);
    this.droppedCommitments.set(settings.droppedCommitments ?? []);
    await this.follow.start();
    this.offerMergeIfNeeded(false);
  }

  ngOnDestroy(): void {
    this.stopCaptureRecording();
    this.follow.stop();
  }

  toggleMenu(): void {
    if (this.menuOpen) this.closeMenu(true);
    else this.openMenu();
  }

  openMenu(): void {
    this.menuOpen = true;
    void this.providers.refresh();
    this.focusSoon(() => {
      const sheet = this.menuSheet()?.nativeElement;
      return sheet?.querySelector<HTMLElement>("button.ghost, button") ?? sheet ?? undefined;
    });
  }

  closeMenu(returnFocus = false): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    if (returnFocus) this.focusSoon(() => this.menuBtn()?.nativeElement);
  }

  focusFind(): void {
    this.focusSoon(() => {
      const input = this.findInput()?.nativeElement;
      input?.select();
      return input;
    });
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.imagePreview) {
      this.closeImagePreview();
      return;
    }
    if (this.personMenu) {
      this.closePersonMenu();
      return;
    }
    if (this.menuOpen) {
      this.closeMenu(true);
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
    if (this.panel === "delete") {
      this.cancelDelete();
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
    if (this.panel === "commitments") {
      this.closeCommitments();
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
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key === ",") {
      event.preventDefault();
      this.openMenu();
      return;
    }
    if (meta && event.key.toLowerCase() === "k" && !event.shiftKey) {
      event.preventDefault();
      this.focusFind();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      this.openCapture();
      return;
    }
    if (event.key === "/" && !meta && !event.altKey && !this.isTypingTarget(event.target)) {
      event.preventDefault();
      this.focusFind();
      return;
    }
    if (this.menuOpen && event.key === "Tab") {
      this.cycleMenuFocus(event);
    }
  }

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointer(event: PointerEvent): void {
    const target = event.target;
    if (this.personMenu) {
      if (target instanceof Element && target.closest("[data-person-menu]")) return;
      this.closePersonMenu();
    }
    if (!this.menuOpen) return;
    if (!(target instanceof Node)) return;
    if (this.menuSheet()?.nativeElement.contains(target)) return;
    if (this.menuBtn()?.nativeElement.contains(target)) return;
    this.closeMenu();
  }

  async open(person: PersonView): Promise<void> {
    this.panel = "none";
    this.menuOpen = false;
    this.personMenu = null;
    this.closeImagePreview();
    this.pendingDelete = null;
    this.fact = "none";
    this.notice = null;
    this.actionError = null;
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
    this.menuOpen = false;
    this.panel = "map";
    this.fact = "none";
    this.mapAssignSlug = this.people.selected()?.slug ?? "";
    this.resetLocationDraft(this.people.selected());
  }

  async closeFile(): Promise<void> {
    this.panel = "none";
    this.fact = "none";
    this.notice = null;
    this.actionError = null;
    this.pinDropped = false;
    this.addingSocial = false;
    this.closeImagePreview();
    this.providers.clearSuggestions();
    this.nameProposal = null;
    this.resetLocationDraft(null);
    await this.people.select(null);
  }

  startCreate(): void {
    this.draft = blankDraft();
    this.showMore = false;
    this.notice = null;
    this.actionError = null;
    this.panel = "create";
    this.menuOpen = false;
    this.fact = "none";
    this.nameProposal = null;
    this.people.selected.set(null);
    this.resetLocationDraft(null);
    this.cdr.detectChanges();
    const name = this.nameField()?.nativeElement;
    if (name) {
      name.focus();
      name.scrollIntoView({ block: "nearest" });
      return;
    }
    this.focusSoon(() => this.nameField()?.nativeElement);
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
    this.actionError = null;
    try {
      if (this.panel === "create") {
        await this.people.createPerson({ ...this.draft });
      } else if (this.panel === "edit" && this.people.selected()) {
        await this.people.updatePerson(this.people.selected()!.slug, { ...this.draft });
      }
      this.panel = "none";
      this.fact = "none";
      this.offerMergeIfNeeded(true);
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : "Could not save this person.";
    }
  }

  setFact(next: FactSurface): void {
    this.fact = this.fact === next ? "none" : next;
    this.notice = null;
    if (this.fact === "pin") {
      this.resetLocationDraft(this.people.selected());
    }
  }

  /** View only. Accept remains the only OKF write for new facts. */
  openTimeline(): void {
    timelineOpenWrites();
    this.fact = this.fact === "timeline" ? "none" : "timeline";
    this.notice = null;
  }

  openCardCommitments(): void {
    commitmentsOpenWrites();
    this.fact = this.fact === "commitments" ? "none" : "commitments";
    this.notice = null;
  }

  openTimelineEvent(row: TimelineEvent): void {
    if (row.kind === "place") this.setFact("pin");
    else if (row.kind === "follow") this.setFact("suggest");
    else this.fact = "none";
    const path = row.path;
    if (!path || typeof document === "undefined") return;
    queueMicrotask(() => {
      const target = document.querySelector(`[data-okf-path="${cssAttr(path)}"]`);
      target?.scrollIntoView({ block: "nearest" });
    });
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
    if (this.desktop) {
      const source = await this.people.pickPhoto();
      if (!source) return;
      await this.people.addPhoto(person.slug, source);
      this.notice = null;
      return;
    }
    document.getElementById("skuffen-photo-file")?.click();
  }

  async pickProfileImage(): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    if (this.desktop) {
      const source = await this.people.pickPhoto();
      if (!source) return;
      await this.people.setProfileImage(person.slug, { sourcePath: source });
      this.notice = null;
      return;
    }
    document.getElementById("skuffen-profile-file")?.click();
  }

  async onProfileFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const person = this.people.selected();
    if (person && file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.people.setProfileImage(person.slug, { fileName: file.name, bytes });
      this.notice = null;
    }
    input.value = "";
  }

  async onPhotoFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    const person = this.people.selected();
    if (person && files?.length) {
      for (const file of Array.from(files)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await this.people.addPhotoBytes(person.slug, file.name, bytes);
      }
      this.notice = null;
    }
    input.value = "";
  }

  async usePhotoAsProfile(photo: PersonView["photos"][number]): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    await this.people.setProfileFromPhoto(person.slug, photo);
    this.notice = null;
  }

  isProfilePhoto(person: PersonView, photo: PersonView["photos"][number]): boolean {
    return Boolean(person.image && photo.resource && person.image === photo.resource);
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
      await this.attachFiles(slug, docs);
    }

    if (images.length) {
      for (const file of images) {
        const path = (file as File & { path?: string }).path;
        if (this.desktop && path) {
          await this.people.addPhoto(slug, path);
          continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        await this.people.addPhotoBytes(slug, file.name, bytes);
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

  async pickAndAddDocument(): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    if (this.desktop) {
      const source = await this.people.pickDocument();
      if (!source) return;
      const fileName = source.split(/[\\/]/).pop() || `document-${Date.now()}`;
      await this.people.addDocument(person.slug, {
        fileName,
        sourcePath: source,
        title: this.docTitle.trim() || stem(fileName),
        kind: DOCUMENT_KIND,
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
      await this.attachFiles(person.slug, files);
    }
    input.value = "";
  }

  async attachFiles(slug: string, files: FileList | File[]): Promise<void> {
    for (const file of Array.from(files)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.people.addDocument(slug, {
        fileName: file.name,
        bytes,
        title: this.docTitle.trim() || stem(file.name),
        kind: DOCUMENT_KIND,
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

  kindLabel(_kind?: string): string {
    return "File";
  }

  private clearDocDraft(): void {
    this.docTitle = "";
    this.docNote = "";
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
    this.openMenu();
    this.researchRequestedWithoutProvider = true;
    return true;
  }

  async ask(): Promise<void> {
    const person = this.people.selected();
    this.fact = "suggest";
    this.notice = null;
    if (this.gateWithoutProvider("Connect Grok in Menu → Providers first.")) {
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
    if (this.gateWithoutProvider("Connect Grok in Menu → Providers first.")) {
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

  /** Research from Add person only. The left-pane field is a local filter. */
  researchDraftName(): void {
    const name = this.draft.title.trim();
    if (!name) return;
    void this.researchName(name);
  }

  async researchName(name: string): Promise<void> {
    const q = name.trim();
    if (!q) return;
    this.notice = null;
    this.actionError = null;
    this.menuOpen = false;
    this.panel = "propose";
    this.people.selected.set(null);
    this.nameProposal = null;
    if (
      this.gateWithoutProvider(
        "Connect Grok in Menu → Providers first. There is no Skuffen cloud account.",
      )
    ) {
      return;
    }
    const suggestions = await this.providers.researchName(q);
    this.nameProposal = proposeNameResearch(q, suggestions);
    try {
      await this.follow.storeResearch(
        "",
        this.nameProposal.facts.map((fact) => fact.suggestion),
        {
          source: "research",
          query: q,
          prompt: this.providers.lastPrompt() ?? undefined,
        },
      );
    } catch (error) {
      this.actionError = nameAcceptErrorMessage(error);
    }
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
    this.actionError = null;
    this.researchRequestedWithoutProvider = false;
    void dismissNameProposal();
    if (pending) {
      for (const fact of pending.facts) {
        void this.follow.rejectSuggestion(fact.id);
      }
    }
  }

  async acceptNameProposal(): Promise<void> {
    const pending = this.nameProposal;
    if (!pending) return;
    const plan = planAcceptedNameProposal(pending);
    if (!plan) {
      this.actionError = "Check at least one fact, then Accept selected.";
      return;
    }
    this.actionError = null;
    this.notice = null;
    const generatedBy = this.providers.actorForActive();
    let created: PersonView | null = null;
    try {
      created = await this.people.createPerson({ ...plan.person, generatedBy });
      try {
        await this.follow.attachNameProposal(pending.query, created.slug);
      } catch {
        /* Card write already happened. Leftover empty-slug facts still accept by id. */
      }
      const skippedPhotos = await this.applyExtras(created.slug, plan.extras, generatedBy);
      for (const fact of pending.facts) {
        await this.follow.acceptLocalOnly(fact.id);
      }
      await this.openAcceptedNameCard(created, skippedPhotosNotice(skippedPhotos));
    } catch (error) {
      this.actionError = nameAcceptErrorMessage(error);
      if (created) {
        await this.openAcceptedNameCard(created, null);
      }
    }
  }

  private async openAcceptedNameCard(created: PersonView, photoNotice: string | null): Promise<void> {
    this.nameProposal = null;
    this.panel = "none";
    this.menuOpen = false;
    this.fact = "none";
    this.query.set("");
    this.researchRequestedWithoutProvider = false;
    this.notice = photoNotice;
    await this.people.select(created.slug);
  }

  photoPreviewUrl(suggestion: FactSuggestion): string | null {
    return photoPreviewUrl(suggestion);
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
    this.menuOpen = false;
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
    await this.self.retarget(plan.incomingSlug, plan.keeperSlug);
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

  private async persistDroppedCommitments(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings({ ...settings, droppedCommitments: this.droppedCommitments() });
  }

  allProposalChecked(): boolean {
    return Boolean(this.nameProposal && this.nameProposal.facts.length > 0 && this.nameProposal.facts.every((fact) => fact.checked));
  }

  suggestionLabel(item: FactSuggestion): string {
    if (item.kind === "photo") return item.url || item.title;
    if (item.kind === "field") return item.value || item.title;
    return item.body || item.value || item.url || item.title;
  }

  async toggleSelf(slug: string): Promise<void> {
    await this.self.toggle(slug);
  }

  askDelete(person: PersonView): void {
    this.closePersonMenu();
    this.closeImagePreview();
    this.pendingDelete = person;
    this.panel = "delete";
    this.menuOpen = false;
    this.notice = null;
    this.actionError = null;
  }

  askDeleteFromList(slug: string): void {
    const person = this.people.people().find((item) => item.slug === slug);
    if (!person) {
      this.personMenu = null;
      return;
    }
    this.askDelete(person);
  }

  cancelDelete(): void {
    this.pendingDelete = null;
    this.panel = "none";
  }

  async confirmDelete(): Promise<void> {
    const person = this.pendingDelete;
    if (!person) return;
    this.actionError = null;
    try {
      await this.people.deletePerson(person.slug);
      await this.follow.forgetSlug(person.slug);
      await this.self.forget(person.slug);
      this.pendingDelete = null;
      this.personMenu = null;
      this.panel = "none";
      this.notice = null;
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : String(error);
    }
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
        const stored = keepFetchedPhoto(
          write,
          await readPublicPhotoBytes(write.url, (url) => this.io.fetchPublicBytes(url)),
        );
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
          { asProfileIfEmpty: true },
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
    this.menuOpen = false;
    this.panel = "providers";
    this.people.selected.set(null);
    void this.providers.refresh();
  }

  openMemory(): void {
    this.menuOpen = false;
    this.panel = "memory";
    this.fact = "none";
    this.checkedSuggestionIds = new Set(pendingFacts(this.memoryRows()).map((item) => item.id));
  }

  async openBrief(slug?: string): Promise<void> {
    this.menuOpen = false;
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
    this.notice = "Local brief is ready offline. Polish needs Grok or Gemini in Menu.";
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
    this.menuOpen = false;
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
    this.notice = "Local draft is ready offline. Polish needs Grok or Gemini in Menu.";
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

  openCommitments(slug?: string): void {
    commitmentsOpenWrites();
    this.menuOpen = false;
    this.panel = "commitments";
    this.fact = "none";
    this.notice = null;
    this.commitmentProposal = null;
    if (slug) {
      void this.people.select(slug);
    }
    if (this.demoMode && !this.commitmentSourceNote.trim()) {
      this.commitmentSourceNote = DEMO_COMMITMENTS.items[0].sourceBody;
    }
  }

  closeCommitments(): void {
    dismissCommitmentWrites();
    this.commitmentProposal = null;
    this.commitmentSourceNote = "";
    this.panel = "none";
    this.notice = null;
  }

  commitmentPerson(): PersonView | null {
    return this.people.selected() ?? this.people.people()[0] ?? null;
  }

  proposeCommitmentsFromCard(): void {
    const person = this.commitmentPerson();
    if (!person) {
      this.notice = "Add a person first. Promises are extracted from a card already on disk.";
      return;
    }
    proposeCommitmentWrites();
    this.notice = null;
    void this.people.select(person.slug);
    this.commitmentProposal = proposeCommitmentsFromAcceptedNotes(person);
    if (!this.commitmentProposal.items.length) {
      this.notice = "No new promises on this card. Accept a note or capture that contains one, then propose.";
    }
  }

  proposeCommitmentsFromSource(): void {
    const person = this.commitmentPerson();
    const text = this.commitmentSourceNote.trim();
    if (!person) {
      this.notice = "Add a person first. Prompts include only that person.";
      return;
    }
    if (!text) return;
    proposeCommitmentWrites();
    this.notice = null;
    void this.people.select(person.slug);
    this.commitmentProposal = proposeCommitmentsFromText(person, text, "capture");
    if (!this.commitmentProposal.items.length) {
      this.notice = "No promise in that note. Try “I promised to…” or “I’ll…”.";
    }
  }

  toggleCommitmentItem(id: string, checked: boolean): void {
    if (!this.commitmentProposal) return;
    this.commitmentProposal = setCommitmentChecked(this.commitmentProposal, id, checked);
  }

  selectAllCommitmentItems(checked: boolean): void {
    if (!this.commitmentProposal) return;
    this.commitmentProposal = setAllCommitmentsChecked(this.commitmentProposal, checked);
  }

  allCommitmentsChecked(): boolean {
    return Boolean(
      this.commitmentProposal &&
        this.commitmentProposal.items.length > 0 &&
        this.commitmentProposal.items.every((item) => item.checked),
    );
  }

  commitmentHasChecked(): boolean {
    return Boolean(this.commitmentProposal?.items.some((item) => item.checked));
  }

  async acceptCommitments(): Promise<void> {
    if (!this.commitmentProposal) return;
    const writes = writesForAcceptedCommitments(this.commitmentProposal);
    for (const write of writes) {
      await this.people.addNote(write.slug, write.title, write.body);
    }
    this.commitmentProposal = null;
    this.commitmentSourceNote = "";
    this.notice = null;
  }

  dismissCommitmentProposal(): void {
    dismissCommitmentWrites();
    this.commitmentProposal = null;
    this.notice = null;
  }

  async markCommitmentDone(row: CommitmentRow): Promise<void> {
    const write = writesForDoneCommitment(row);
    if (!write) return;
    await this.people.addNote(write.slug, write.title, write.body);
    this.notice = null;
  }

  async dropCommitment(row: CommitmentRow): Promise<void> {
    dropCommitmentWrites();
    this.droppedCommitments.set(rememberDroppedCommitment(this.droppedCommitments(), row.id));
    await this.persistDroppedCommitments();
    this.notice = null;
  }

  async seedDemoCommitments(): Promise<void> {
    if (!this.demoMode) return;
    const draft = DEMO_COMMITMENTS;
    let ada = this.people.people().find((item) => item.title === draft.person.title);
    if (!ada) {
      ada = await this.people.createPerson({
        title: draft.person.title,
        description: draft.person.description,
        email: draft.person.email,
      });
    }
    const existingTitles = new Set(ada.notes.map((note) => note.title));
    for (const item of draft.items) {
      if (!existingTitles.has(item.sourceTitle)) {
        await this.people.addNote(ada.slug, item.sourceTitle, item.sourceBody);
        existingTitles.add(item.sourceTitle);
      }
      const title = commitmentTitle(item.what);
      if (!existingTitles.has(title)) {
        const dueDate = "dueDate" in item ? item.dueDate : undefined;
        await this.people.addNote(ada.slug, title, commitmentNoteBody({ what: item.what, dueDate }));
        existingTitles.add(title);
      }
    }
    this.openCommitments(ada.slug);
  }

  canRecordCapture(): boolean {
    return this.desktop && !this.demoMode && speechRecognitionAvailable();
  }

  openCapture(slug?: string): void {
    this.menuOpen = false;
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
    this.focusSoon(() => this.captureField()?.nativeElement);
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
        "Connect Grok in Menu → Providers first. There is no Skuffen cloud account.",
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

  personCue(person: PersonView): string {
    const bits: string[] = [];
    if (person.description) bits.push(person.description);
    if (this.self.isSelf(person.slug)) bits.push("This is me");
    if (this.follow.followFor(person.slug)) bits.push("Followed");
    const proposed = this.follow.suggestionsFor(person.slug).length;
    if (proposed) bits.push(`${proposed} proposed`);
    return bits.join(" · ");
  }

  personPhotoUrl(person: PersonView): string | null {
    const fromProfile = personListPhotoUrl(person.imageSrc ?? person.image);
    if (fromProfile) return fromProfile;
    const photo = person.photos[0];
    return personListPhotoUrl(photo?.listSrc ?? photo?.resource);
  }

  hasProfilePhoto(person: PersonView): boolean {
    return Boolean(person.image && personListPhotoUrl(person.imageSrc));
  }

  openProfilePreview(person: PersonView): void {
    this.openImagePreview(this.personPhotoUrl(person), {
      title: person.title,
      diorama: this.hasProfilePhoto(person),
    });
  }

  openPhotoPreview(person: PersonView, photo: PersonView["photos"][number]): void {
    this.openImagePreview(photo.listSrc, {
      title: photo.title,
      diorama: this.isProfilePhoto(person, photo),
    });
  }

  openImagePreview(src: string | null | undefined, options?: { title?: string; diorama?: boolean }): void {
    const local = previewImageSrc(src);
    if (!local) return;
    this.personMenu = null;
    this.imagePreview = {
      src: local,
      title: options?.title,
      diorama: Boolean(options?.diorama),
    };
  }

  closeImagePreview(): void {
    this.imagePreview = null;
  }

  makeSelectedDiorama(): void {
    const slug = this.people.selected()?.slug;
    if (slug) void this.makeDiorama(slug);
  }

  openPersonMenu(event: MouseEvent, person: PersonView): void {
    event.preventDefault();
    event.stopPropagation();
    const width = 220;
    const height = 52;
    const pad = 8;
    const x = Math.max(pad, Math.min(event.clientX, window.innerWidth - width - pad));
    const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - height - pad));
    this.personMenu = { slug: person.slug, x, y };
  }

  closePersonMenu(): void {
    this.personMenu = null;
  }

  async makeDiorama(slug: string): Promise<void> {
    this.closePersonMenu();
    this.closeImagePreview();
    if (this.dioramaBusy) return;
    if (!this.demoMode && !this.providers.grokConnected()) {
      this.notice = DIORAMA_NEEDS_GROK;
      this.openProviders();
      return;
    }
    await this.openBySlug(slug);
    const person = this.people.selected();
    if (!person || person.slug !== slug) {
      this.actionError = "Could not open that card.";
      return;
    }
    const sourceResource = person.image;
    const source = sourceResource ? await this.people.readPhotoBytes(sourceResource) : null;
    if (!source) {
      this.actionError = DIORAMA_NEEDS_PHOTO;
      this.notice = null;
      return;
    }
    this.actionError = null;
    this.notice = DIORAMA_PROGRESS;
    this.dioramaBusy = true;
    try {
      const mime = sniffImageMime(source) ?? undefined;
      const bytes = await this.providers.imagineDiorama(source, mime);
      if (!bytes) {
        this.actionError = this.providers.error() || "Could not make a 3D clay diorama.";
        this.notice = null;
        return;
      }
      const ext = extensionForMime(sniffImageMime(bytes) ?? mime ?? "image/png");
      await this.people.setProfileImage(slug, {
        fileName: `diorama-${Date.now().toString(36)}.${ext}`,
        bytes,
        title: DIORAMA_PHOTO_TITLE,
        generatedBy: this.providers.actorForImagine(),
      });
      this.notice = null;
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : "Could not save the diorama.";
      this.notice = null;
    } finally {
      this.dioramaBusy = false;
    }
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

  private focusSoon(getEl: () => HTMLElement | undefined): void {
    requestAnimationFrame(() => getEl()?.focus());
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return target.isContentEditable;
  }

  private cycleMenuFocus(event: KeyboardEvent): void {
    const sheet = this.menuSheet()?.nativeElement;
    if (!sheet) return;
    const nodes = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((el) => el.tabIndex !== -1 && !el.hasAttribute("disabled"));
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !sheet.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
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

function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
