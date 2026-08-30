import { Injectable, computed, inject, signal } from "@angular/core";
import { demoResearchPrompt, demoResearchSuggestions, isDemoMode } from "../demo-mode";
import type { AgentMemoryTurn, FactSuggestion, FollowInterval, FollowRecord, StoredProposal, SuggestionSource } from "../models";
import {
  appendMemoryTurn,
  clearMemoryLog,
  deleteMemoryTurn,
  makeStoredProposal,
  recordMemoryTurn,
  removeProposal,
} from "./memory";
import { IoService } from "./io.service";
import { PeopleService } from "./people.service";
import { ProvidersService } from "./providers.service";
import {
  buildResearchPrompt,
  dueFollows,
  mergeFollow,
  normalizeInterval,
  proposalsForSlug,
  recordFollowRun,
  removeSuggestion,
  settingsWithoutSecrets,
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
  readonly memoryLog = signal<AgentMemoryTurn[]>([]);
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
    this.memoryLog.set(settings.memoryLog ?? []);
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

  async storeResearch(
    slug: string,
    suggestions: FactSuggestion[],
    options?: { source?: SuggestionSource; prompt?: string; query?: string },
  ): Promise<void> {
    if (!suggestions.length) return;
    const now = new Date();
    const source = options?.source ?? "research";
    const proposal = makeStoredProposal({
      id: `${source}-${slug || options?.query || "name"}-${now.getTime()}`,
      slug,
      query: options?.query,
      source,
      createdAt: now.toISOString(),
      prompt: options?.prompt,
      suggestions,
    });
    this.proposals.set(upsertProposal(this.proposals(), proposal));
    if (options?.prompt) {
      this.memoryLog.set(
        appendMemoryTurn(
          this.memoryLog(),
          recordMemoryTurn({
            now,
            slug: slug || undefined,
            query: options.query,
            source,
            prompt: options.prompt,
            suggestions,
          }),
        ),
      );
    }
    await this.persist();
  }

  async setFollow(slug: string, enabled: boolean, interval: FollowInterval = "weekly"): Promise<void> {
    const known = new Set(this.people.people().map((person) => person.slug));
    if (!known.has(slug)) return;
    const next = enabled ? mergeFollow(this.follows(), slug, interval, new Date()) : dropFollow(this.follows(), slug);
    this.follows.set(next);
    if (enabled && isDemoMode()) {
      const person = this.people.people().find((item) => item.slug === slug);
      const suggestions = demoResearchSuggestions("follow");
      const prompt = demoResearchPrompt(person?.title ?? slug);
      await this.storeResearch(slug, suggestions, { source: "follow", prompt });
      return;
    }
    await this.persist();
  }

  async rejectSuggestion(id: string): Promise<void> {
    this.proposals.set(removeSuggestion(this.proposals(), id));
    await this.persist();
  }

  async dismissProposal(proposalId: string): Promise<void> {
    this.proposals.set(removeProposal(this.proposals(), proposalId));
    await this.persist();
  }

  async acceptLocalOnly(id: string): Promise<void> {
    await this.rejectSuggestion(id);
  }

  async forgetSlug(slug: string): Promise<void> {
    this.follows.set(dropFollow(this.follows(), slug));
    this.proposals.set(this.proposals().filter((item) => item.slug !== slug));
    await this.persist();
  }

  async retargetSlug(fromSlug: string, toSlug: string): Promise<void> {
    if (fromSlug === toSlug) return;
    const known = new Set(this.people.people().map((person) => person.slug));
    known.add(toSlug);
    const incomingFollow = this.follows().find((item) => item.slug === fromSlug);
    let follows = dropFollow(this.follows(), fromSlug);
    if (incomingFollow && !follows.some((item) => item.slug === toSlug) && known.has(toSlug)) {
      follows = [...follows, { ...incomingFollow, slug: toSlug }];
    }
    this.follows.set(follows);
    this.proposals.set(
      this.proposals().map((item) => (item.slug === fromSlug ? { ...item, slug: toSlug } : item)),
    );
    await this.persist();
  }

  async deleteTold(id: string): Promise<void> {
    this.memoryLog.set(deleteMemoryTurn(this.memoryLog(), id));
    await this.persist();
  }

  async clearTold(): Promise<void> {
    this.memoryLog.set(clearMemoryLog());
    await this.persist();
  }

  async tick(): Promise<void> {
    if (this.ticking() || this.people.locked()) return;
    const provider = this.providers.activeProvider();
    if (!provider && !isDemoMode()) return;
    const known = new Set(this.people.people().map((person) => person.slug));
    const due = dueFollows(this.follows(), new Date(), known);
    if (due.length === 0) return;

    this.ticking.set(true);
    try {
      let follows = this.follows();
      let proposals = this.proposals();
      let memoryLog = this.memoryLog();
      for (const follow of due) {
        const person = this.people.people().find((item) => item.slug === follow.slug);
        if (!person) continue;
        const now = new Date();
        try {
          const prompt = buildResearchPrompt(person);
          const suggestions = await this.providers.researchPerson(person, "follow");
          if (suggestions.length) {
            const proposal = makeStoredProposal({
              id: `follow-${person.slug}-${now.getTime()}`,
              slug: person.slug,
              source: "follow",
              createdAt: now.toISOString(),
              prompt,
              suggestions,
            });
            proposals = upsertProposal(proposals, proposal);
            memoryLog = appendMemoryTurn(
              memoryLog,
              recordMemoryTurn({
                now,
                slug: person.slug,
                source: "follow",
                prompt,
                suggestions,
              }),
            );
          }
          follows = follows.map((item) => (item.slug === follow.slug ? recordFollowRun(item, now, true) : item));
        } catch {
          follows = follows.map((item) => (item.slug === follow.slug ? recordFollowRun(item, now, false) : item));
        }
      }
      this.follows.set(follows);
      this.proposals.set(proposals);
      this.memoryLog.set(memoryLog);
      this.lastTickAt.set(new Date().toISOString());
      await this.persist();
    } finally {
      this.ticking.set(false);
    }
  }

  private async persist(): Promise<void> {
    const settings = await this.io.getSettings();
    await this.io.saveSettings(
      settingsWithoutSecrets({
        ...settings,
        follows: this.follows(),
        proposals: this.proposals(),
        memoryLog: this.memoryLog(),
      }) as typeof settings,
    );
  }
}
