import { Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { FactSuggestion, PersonView, ProviderId } from "./models";
import { isTauri } from "./services/io.service";
import { PeopleService } from "./services/people.service";
import { ProvidersService } from "./services/providers.service";

@Component({
  selector: "app-root",
  imports: [FormsModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit {
  readonly people = inject(PeopleService);
  readonly providers = inject(ProvidersService);

  query = "";
  panel: "none" | "create" | "edit" | "providers" = "none";
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
    const q = this.query.trim().toLowerCase();
    const all = this.people.people();
    if (!q) return all;
    return all.filter((person) => `${person.title} ${person.description ?? ""}`.toLowerCase().includes(q));
  });

  readonly empty = computed(() => this.people.ready() && this.people.people().length === 0);
  readonly activeProvider = computed(() => this.providers.activeProvider());
  readonly bothProviders = computed(() => this.providers.availableProviders().length === 2);

  async ngOnInit(): Promise<void> {
    await this.people.bootstrap();
    await this.providers.refresh();
  }

  async open(person: PersonView): Promise<void> {
    this.panel = "none";
    await this.people.select(person.slug);
  }

  startCreate(): void {
    this.draft = blankDraft();
    this.panel = "create";
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
  }

  async addNote(): Promise<void> {
    const person = this.people.selected();
    if (!person || !this.noteTitle.trim() || !this.noteBody.trim()) return;
    await this.people.addNote(person.slug, this.noteTitle.trim(), this.noteBody.trim());
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
  }

  async addPhoto(): Promise<void> {
    const person = this.people.selected();
    if (!person) return;
    const source = await this.people.pickPhoto();
    if (!source) return;
    await this.people.addPhoto(person.slug, source);
  }

  async ask(): Promise<void> {
    const person = this.people.selected();
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

  async unlock(): Promise<void> {
    await this.people.unlock();
  }

  async lock(): Promise<void> {
    await this.people.lock();
    this.panel = "none";
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

  initials(title: string): string {
    return title
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
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
