import { Component, computed, HostListener, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { FactSuggestion, PersonView, ProviderId } from "./models";
import { isTauri } from "./services/io.service";
import { PeopleService } from "./services/people.service";
import { ProvidersService } from "./services/providers.service";

type Panel = "none" | "create" | "edit" | "providers";
type FactSurface = "none" | "drop" | "pin" | "note" | "suggest";

@Component({
  selector: "app-root",
  imports: [FormsModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit {
  readonly people = inject(PeopleService);
  readonly providers = inject(ProvidersService);

  readonly query = signal("");
  panel: Panel = "none";
  fact: FactSurface = "none";
  latchOpen = false;
  showMore = false;
  addingSocial = false;
  dragging = false;
  pinDropped = false;
  notice: string | null = null;
  draft = blankDraft();
  noteTitle = "";
  noteBody = "";
  socialNetwork = "";
  socialHandle = "";
  socialUrl = "";
  grokKey = "";
  geminiKey = "";
  readonly desktop = isTauri();

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

  async ngOnInit(): Promise<void> {
    await this.people.bootstrap();
    await this.providers.refresh();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.latchOpen) {
      this.latchOpen = false;
      return;
    }
    if (this.panel === "providers" || this.panel === "create" || this.panel === "edit") {
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
    await this.people.select(person.slug);
  }

  async closeFile(): Promise<void> {
    this.panel = "none";
    this.fact = "none";
    this.notice = null;
    this.pinDropped = false;
    this.addingSocial = false;
    this.providers.clearSuggestions();
    await this.people.select(null);
  }

  startCreate(): void {
    this.draft = blankDraft();
    this.showMore = false;
    this.panel = "create";
    this.latchOpen = false;
    this.fact = "none";
    this.people.selected.set(null);
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
    if (!this.people.selected()) return;
    event.preventDefault();
    this.dragging = true;
    this.fact = "drop";
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
    await this.ingestFiles(Array.from(files));
  }

  async ingestFiles(files: File[]): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    this.fact = "drop";
    const images = files.filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name));
    const other = files.filter((file) => !images.includes(file));
    if (other.length) {
      this.notice = "Documents drop here later. Nothing was written.";
    }
    if (!images.length) return;
    if (!this.desktop) {
      this.notice = "Photos need the desktop shell. Nothing was written.";
      return;
    }
    let wrote = 0;
    for (const file of images) {
      const path = (file as File & { path?: string }).path;
      if (!path) continue;
      await this.people.addPhoto(person.slug, path);
      wrote += 1;
    }
    this.notice = wrote
      ? null
      : "Drop needs a file path. Use Pick a photo — nothing was written.";
  }

  dropPin(): void {
    this.pinDropped = true;
    this.notice = "Pin stays on this machine later. Nothing was written.";
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

  async accept(suggestion: FactSuggestion): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    const generatedBy = this.providers.actorForActive();
    if (suggestion.kind === "social" && suggestion.url) {
      await this.people.addSocial(
        person.slug,
        suggestion.network || "web",
        suggestion.url,
        suggestion.handle,
        generatedBy,
      );
    } else if (suggestion.kind === "field" && suggestion.field && suggestion.value) {
      await this.people.updatePerson(person.slug, { [suggestion.field]: suggestion.value });
    } else {
      await this.people.addNote(
        person.slug,
        suggestion.title,
        suggestion.body || suggestion.value || suggestion.title,
        generatedBy,
      );
    }
    this.providers.reject(suggestion.id);
  }

  reject(suggestion: FactSuggestion): void {
    this.providers.reject(suggestion.id);
  }

  openProviders(): void {
    this.latchOpen = false;
    this.panel = "providers";
    this.people.selected.set(null);
  }

  async unlock(): Promise<void> {
    await this.people.unlock();
  }

  async lock(): Promise<void> {
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
