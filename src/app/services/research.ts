import type { FactSuggestion, FollowInterval, FollowRecord, PersonView, StoredProposal } from "../models";

export const RESEARCH_SYSTEM =
  "You return compact JSON only. Search public web sources. Never request the full people-graph. Never invent people. Never draft or send messages.";

const INTERVAL_MS: Record<FollowInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export type PersonPromptInput = Pick<
  PersonView,
  "slug" | "title" | "description" | "givenName" | "familyName" | "body" | "notes" | "social"
>;

export type OkfWriteIntent =
  | { type: "note"; slug: string; title: string; body: string }
  | { type: "social"; slug: string; network: string; url: string; handle?: string }
  | { type: "field"; slug: string; field: "description" | "body"; value: string };

export function normalizeInterval(value: unknown): FollowInterval {
  return value === "daily" || value === "monthly" ? value : "weekly";
}

export function nextRunAt(interval: FollowInterval, from: Date): string {
  return new Date(from.getTime() + INTERVAL_MS[interval]).toISOString();
}

export function isFollowDue(follow: FollowRecord, now: Date): boolean {
  if (!follow.enabled) return false;
  if (!follow.nextRunAt) return true;
  const due = Date.parse(follow.nextRunAt);
  return Number.isFinite(due) && due <= now.getTime();
}

export function dueFollows(
  follows: FollowRecord[],
  now: Date,
  knownSlugs: ReadonlySet<string>,
): FollowRecord[] {
  return follows.filter(
    (follow) => follow.enabled && knownSlugs.has(follow.slug) && isFollowDue(follow, now),
  );
}

export function buildResearchPrompt(person: PersonPromptInput): string {
  const notes = person.notes.map((n) => `- ${n.title}: ${n.body.slice(0, 280)}`).join("\n") || "(none)";
  const social =
    person.social.map((s) => `- ${s.network ?? "profile"} ${s.handle ?? ""} ${s.url ?? ""}`).join("\n") ||
    "(none)";
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Search the public web for current, sourced facts about this one person.",
    "Suggest at most 5 structured facts. Results are suggestions only.",
    "Do not invent people. Do not create a new person. Do not ask for or assume the rest of the people-graph.",
    "Do not draft outreach. Do not send messages. Do not upload or request the full graph.",
    'Return ONLY JSON: {"suggestions":[{"kind":"note"|"social"|"field","title":"","body":"","network":"","url":"","handle":"","field":"description"|"body","value":""}]}',
    `Name: ${person.title}`,
    `Given name: ${person.givenName ?? ""}`,
    `Family name: ${person.familyName ?? ""}`,
    `Description: ${person.description ?? ""}`,
    `About:\n${person.body}`,
    `Existing notes:\n${notes}`,
    `Existing social:\n${social}`,
  ].join("\n");
}

export function parseSuggestions(text: string, source: FactSuggestion["source"] = "research"): FactSuggestion[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  let parsed: { suggestions?: Array<Partial<FactSuggestion>> };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { suggestions?: Array<Partial<FactSuggestion>> };
  } catch {
    return [];
  }
  return (parsed.suggestions ?? []).map((item, index) => ({
    id: `${source}-${Date.now()}-${index}`,
    source,
    kind: item.kind === "social" || item.kind === "field" ? item.kind : "note",
    title: String(item.title ?? "Suggestion"),
    body: item.body,
    network: item.network,
    url: item.url,
    handle: item.handle,
    field: item.field === "body" ? "body" : item.field === "description" ? "description" : undefined,
    value: item.value,
  }));
}

export function extractModelText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  const outputText = obj["output_text"];
  if (typeof outputText === "string" && outputText.trim()) return outputText;
  const choices = obj["choices"] as Array<{ message?: { content?: unknown } }> | undefined;
  const chat = choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat.trim()) return chat;
  const output = obj["output"];
  if (Array.isArray(output)) {
    const texts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string") texts.push(content);
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string") {
            texts.push((part as { text: string }).text);
          }
        }
      }
    }
    if (texts.length) return texts.join("\n");
  }
  return "";
}

export function grokResearchRequest(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    input: [
      { role: "system", content: RESEARCH_SYSTEM },
      { role: "user", content: prompt },
    ],
    tools: [{ type: "web_search" }],
  };
}

export function geminiResearchConfig(): { tools: Array<{ googleSearch: Record<string, never> }> } {
  return { tools: [{ googleSearch: {} }] };
}

export function writesForAcceptedSuggestion(slug: string, suggestion: FactSuggestion): OkfWriteIntent {
  if (suggestion.kind === "social" && suggestion.url) {
    return {
      type: "social",
      slug,
      network: suggestion.network || "web",
      url: suggestion.url,
      handle: suggestion.handle,
    };
  }
  if (suggestion.kind === "field" && suggestion.field && suggestion.value) {
    return { type: "field", slug, field: suggestion.field, value: suggestion.value };
  }
  return {
    type: "note",
    slug,
    title: suggestion.title,
    body: suggestion.body || suggestion.value || suggestion.title,
  };
}

export function proposeOnly(_suggestions: FactSuggestion[]): OkfWriteIntent[] {
  return [];
}

export function settingsWithoutSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  const blocked = /token|secret|password|api[_-]?key|authorization|bearer/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (blocked.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function mergeFollow(follows: FollowRecord[], slug: string, interval: FollowInterval, now: Date): FollowRecord[] {
  const record: FollowRecord = {
    slug,
    interval,
    enabled: true,
    lastRunAt: follows.find((item) => item.slug === slug)?.lastRunAt ?? null,
    nextRunAt: nextRunAt(interval, now),
  };
  return [...follows.filter((item) => item.slug !== slug), record];
}

export function unfollow(follows: FollowRecord[], slug: string): FollowRecord[] {
  return follows.filter((item) => item.slug !== slug);
}

export function recordFollowRun(
  follow: FollowRecord,
  now: Date,
  ok: boolean,
): FollowRecord {
  if (ok) {
    return {
      ...follow,
      lastRunAt: now.toISOString(),
      nextRunAt: nextRunAt(follow.interval, now),
      lastError: null,
    };
  }
  return {
    ...follow,
    nextRunAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    lastError: "research-failed",
  };
}

export function upsertProposal(
  proposals: StoredProposal[],
  proposal: StoredProposal,
): StoredProposal[] {
  return [...proposals.filter((item) => item.id !== proposal.id), proposal];
}

export function removeSuggestion(
  proposals: StoredProposal[],
  suggestionId: string,
): StoredProposal[] {
  return proposals
    .map((proposal) => ({
      ...proposal,
      suggestions: proposal.suggestions.filter((item) => item.id !== suggestionId),
    }))
    .filter((proposal) => proposal.suggestions.length > 0);
}

export function proposalsForSlug(proposals: StoredProposal[], slug: string): FactSuggestion[] {
  return proposals.filter((item) => item.slug === slug).flatMap((item) => item.suggestions);
}

export function assertNoAutoWrite(writes: unknown[]): void {
  if (writes.length > 0) {
    throw new Error("research/follow must not auto-write");
  }
}

export function assertNoAutoSend(sends: unknown[]): void {
  if (sends.length > 0) {
    throw new Error("research/follow must not auto-send messages");
  }
}
