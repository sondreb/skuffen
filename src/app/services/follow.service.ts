import { Injectable, computed, inject, signal } from "@angular/core";
import type { FactSuggestion, FollowInterval, FollowRecord, StoredProposal } from "../models";
import { IoService } from "./io.service";
import { PeopleService } from "./people.service";
import { ProvidersService } from "./providers.service";
import {
  dueFollows,
  mergeFollow,
  normalizeInterval,
  proposalsForSlug,
  recordFollowRun,
  removeSuggestion,
  unfollow as dropFollow,
  upsertProposal,
} from "./research";

const TICK_MS = 60_000;

@Injectable({ providedIn: "root" })
export class FollowService {
  private readonly io = inject(IoService);
  private readonly people = inject(PeopleService);
  private readonly providers = inject(ProvidersService);

  readonly follows = signal<FollowRecord[]>([]);
  readonly proposals = signal<StoredProposal[]>([]);
  readonly ticking = signal(false);
  readonly lastTickAt = signal<string | null>(null);

  readonly pendingCount = computed(() =>
    this.proposals().reduce((sum, item) => sum + item.suggestions.length, 0),
  );

  private timer: ReturnType<typeof setInterval> | null = null;

  followFor(slug: string): FollowRecord | null {
    return this.follows().find((item) => item.slug === slug) ?? null;
  }

  suggestionsFor(slug: string): FactSuggestion[] {
    return proposalsForSlug(this.proposals(), slug);
  }

  async load(): Promise<void> {
    const settings = await this.io.getSettings();
    this.follows.set((settings.follows ?? []).map((item) => ({ ...item, interval: normalizeInterval(item.interval) })));
    this.proposals.set(settings.proposals ?? []);
  }

  async start(): Promise<void> {
    await this.load();
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async storeResearch(slug: string, suggestions: FactSuggestion[]): Promise<void> {
    if (!suggestions.length) return;
    const now = new Date();
    this.proposals.set(
      upsertProposal(this.proposals(), {
        id: `research-${slug}-${now.getTime()}`,
        slug,
        source: "research",
        createdAt: now.toISOString(),
        suggestions,
      }),
    );
    await this.persist();
  }

  async setFollow(slug: string, enabled: boolean, interval: FollowInterval = "weekly"): Promise<void> {
    const known = new Set(this.people.people().map((person) => person.slug));
    if (!known.has(slug)) return;
    const next = enabled ? mergeFollow(this.follows(), slug, interval, new Date()) : dropFollow(this.follows(), slug);
    this.follows.set(next);
    await this.persist();
  }

  async rejectSuggestion(id: string): Promise<void> {
    this.proposals.set(removeSuggestion(this.proposals(), id));
    await this.persist();
  }

  async acceptLocalOnly(id: string): Promise<void> {
    await this.rejectSuggestion(id);
  }

  async tick(): Promise<void> {
    if (this.ticking() || this.people.locked()) return;
    const provider = this.providers.activeProvider();
    if (!provider) return;
    const known = new Set(this.people.people().map((person) => person.slug));
    const due = dueFollows(this.follows(), new Date(), known);
    if (due.length === 0) return;

    this.ticking.set(true);
    try {
      let follows = this.follows();
      let proposals = this.proposals();
      for (const follow of due) {
        const person = this.people.people().find((item) => item.slug === follow.slug);
        if (!person) continue;
        const now = new Date();
        try {
          const suggestions = await this.providers.researchPerson(person, "follow");
          if (suggestions.length) {
            proposals = upsertProposal(proposals, {
              id: `follow-${person.slug}-${now.getTime()}`,
              slug: person.slug,
              source: "follow",
              createdAt: now.toISOString(),
              suggestions,
            });
          }
          follows = follows.map((item) => (item.slug === follow.slug ? recordFollowRun(item, now, true) : item));
        } catch {
          follows = follows.map((item) => (item.slug === follow.slug ? recordFollowRun(item, now, false) : item));
        }
      }
      this.follows.set(follows);
      this.proposals.set(proposals);
      this.lastTickAt.set(new Date().toISOString());
      await this.persist();
    } finally {
      this.ticking.set(false);
    }
  }

  private async persist(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings({
      ...settings,
      follows: this.follows(),
      proposals: this.proposals(),
    });
  }
}
