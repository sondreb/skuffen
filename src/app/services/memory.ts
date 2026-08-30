import type {
  AgentMemoryTurn,
  FactSuggestion,
  FollowRecord,
  MemoryTrust,
  StoredProposal,
  SuggestionSource,
} from "../models";

export type { AgentMemoryTurn, MemoryTrust };

export interface PendingMemoryFact {
  kind: "pending-fact";
  id: string;
  proposalId: string;
  slug?: string;
  query?: string;
  personLabel: string;
  source: string;
  createdAt: string;
  prompt?: string;
  suggestion: FactSuggestion;
  trust: MemoryTrust;
  wantedSummary: string;
}

export interface FollowMemoryRow {
  kind: "follow";
  id: string;
  slug: string;
  personLabel: string;
  interval: FollowRecord["interval"];
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface ToldMemoryRow {
  kind: "told";
  id: string;
  createdAt: string;
  personLabel: string;
  source: string;
  prompt: string;
  wantedSummaries: string[];
  trust: MemoryTrust;
}

export type InspectableMemoryRow = PendingMemoryFact | FollowMemoryRow | ToldMemoryRow;

export interface PendingMemoryGroup {
  proposalId: string;
  slug?: string;
  query?: string;
  personLabel: string;
  source: string;
  createdAt: string;
  prompt?: string;
  trust: MemoryTrust;
  facts: PendingMemoryFact[];
}

export function wantedSummary(suggestion: FactSuggestion): string {
  if (suggestion.kind === "photo") return suggestion.url || suggestion.title;
  if (suggestion.kind === "field") {
    return `${suggestion.field ?? "field"}: ${suggestion.value || suggestion.title}`;
  }
  return suggestion.body || suggestion.value || suggestion.url || suggestion.title;
}

export function trustForSource(source: SuggestionSource | StoredProposal["source"]): MemoryTrust {
  return source === "ask" ? "local" : "hostile-web";
}

export function recordMemoryTurn(input: {
  id?: string;
  now?: Date;
  slug?: string;
  query?: string;
  source: SuggestionSource;
  prompt: string;
  suggestions: FactSuggestion[];
}): AgentMemoryTurn {
  const now = input.now ?? new Date();
  return {
    id: input.id ?? `told-${input.source}-${now.getTime()}`,
    createdAt: now.toISOString(),
    slug: input.slug,
    query: input.query,
    source: input.source,
    prompt: input.prompt,
    wanted: input.suggestions.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      summary: wantedSummary(item),
    })),
    trust: trustForSource(input.source),
  };
}

export function appendMemoryTurn(log: AgentMemoryTurn[], turn: AgentMemoryTurn): AgentMemoryTurn[] {
  return [...log.filter((item) => item.id !== turn.id), turn];
}

export function deleteMemoryTurn(log: AgentMemoryTurn[], id: string): AgentMemoryTurn[] {
  return log.filter((item) => item.id !== id);
}

export function clearMemoryLog(): AgentMemoryTurn[] {
  return [];
}

export function makeStoredProposal(input: {
  id?: string;
  slug?: string;
  query?: string;
  source: StoredProposal["source"];
  createdAt?: string;
  prompt?: string;
  suggestions: FactSuggestion[];
}): StoredProposal {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const stamp = Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : Date.now();
  return {
    id: input.id ?? `${input.source}-${input.slug || input.query || "name"}-${stamp}`,
    slug: input.slug ?? "",
    query: input.query,
    source: input.source,
    createdAt,
    prompt: input.prompt,
    trust: trustForSource(input.source),
    suggestions: input.suggestions,
  };
}

export function removeProposal(proposals: StoredProposal[], proposalId: string): StoredProposal[] {
  return proposals.filter((item) => item.id !== proposalId);
}

export function personLabelFor(
  people: ReadonlyArray<{ slug: string; title: string }>,
  slug?: string,
  query?: string,
): string {
  if (slug) {
    const title = people.find((person) => person.slug === slug)?.title;
    if (title) return title;
  }
  return query || slug || "Proposed card";
}

export function inspectableMemory(input: {
  proposals: StoredProposal[];
  follows: FollowRecord[];
  people: Array<{ slug: string; title: string }>;
  memoryLog?: AgentMemoryTurn[];
}): InspectableMemoryRow[] {
  const rows: InspectableMemoryRow[] = [];

  for (const proposal of input.proposals) {
    const label = personLabelFor(input.people, proposal.slug, proposal.query);
    const trust = proposal.trust ?? trustForSource(proposal.source);
    for (const suggestion of proposal.suggestions) {
      rows.push({
        kind: "pending-fact",
        id: suggestion.id,
        proposalId: proposal.id,
        slug: proposal.slug || undefined,
        query: proposal.query,
        personLabel: label,
        source: proposal.source,
        createdAt: proposal.createdAt,
        prompt: proposal.prompt,
        suggestion,
        trust,
        wantedSummary: wantedSummary(suggestion),
      });
    }
  }

  for (const follow of input.follows) {
    if (!follow.enabled) continue;
    rows.push({
      kind: "follow",
      id: `follow-${follow.slug}`,
      slug: follow.slug,
      personLabel: personLabelFor(input.people, follow.slug),
      interval: follow.interval,
      enabled: follow.enabled,
      lastRunAt: follow.lastRunAt,
      nextRunAt: follow.nextRunAt,
    });
  }

  for (const turn of input.memoryLog ?? []) {
    rows.push({
      kind: "told",
      id: turn.id,
      createdAt: turn.createdAt,
      personLabel: personLabelFor(input.people, turn.slug, turn.query),
      source: turn.source,
      prompt: turn.prompt,
      wantedSummaries: turn.wanted.map((item) => item.summary),
      trust: turn.trust,
    });
  }

  return rows;
}

export function pendingFacts(rows: InspectableMemoryRow[]): PendingMemoryFact[] {
  return rows.filter((row): row is PendingMemoryFact => row.kind === "pending-fact");
}

export function followRows(rows: InspectableMemoryRow[]): FollowMemoryRow[] {
  return rows.filter((row): row is FollowMemoryRow => row.kind === "follow");
}

export function toldRows(rows: InspectableMemoryRow[]): ToldMemoryRow[] {
  return rows.filter((row): row is ToldMemoryRow => row.kind === "told");
}

export function groupPendingFacts(facts: PendingMemoryFact[]): PendingMemoryGroup[] {
  const groups = new Map<string, PendingMemoryGroup>();
  for (const fact of facts) {
    let group = groups.get(fact.proposalId);
    if (!group) {
      group = {
        proposalId: fact.proposalId,
        slug: fact.slug,
        query: fact.query,
        personLabel: fact.personLabel,
        source: fact.source,
        createdAt: fact.createdAt,
        prompt: fact.prompt,
        trust: fact.trust,
        facts: [],
      };
      groups.set(fact.proposalId, group);
    }
    group.facts.push(fact);
  }
  return [...groups.values()];
}

/** Propose-only: storing inspectable memory must never produce OKF write intents. */
export function memoryProposeWrites(): never[] {
  return [];
}
