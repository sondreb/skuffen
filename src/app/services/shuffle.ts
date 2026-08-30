import type { FollowRecord, PersonView } from "../models";
import type { OkfWriteIntent } from "./research";

export const DAILY_RECONNECT_LIMIT = 2;

export const RECONNECT_SYSTEM =
  "You draft a reconnect message for one person. Use only the facts given. Never request the full people-graph. Never invent people. Never send messages.";

export type ShuffleDraftSource = "local" | "polished";

export type ShuffleReasonKind = "last-note" | "last-accept" | "follow" | "recency";

export interface ShuffleCardInput {
  person: PersonView;
  follow?: FollowRecord | null;
  /** ISO last-accept already on this machine. Never scored in the cloud. */
  lastAcceptedAt?: string | null;
}

export interface ShuffleReason {
  id: string;
  kind: ShuffleReasonKind;
  title: string;
  body: string;
}

export interface ReconnectSuggestion {
  id: string;
  slug: string;
  title: string;
  lastNoteTitle?: string;
  lastNoteBody?: string;
  lastTouchAt: string | null;
  lastAcceptedAt: string | null;
  followInterval?: FollowRecord["interval"];
  followNextAt?: string | null;
  recencyLabel: string;
  reasons: ShuffleReason[];
}

export interface ReconnectDraft {
  slug: string;
  personTitle: string;
  body: string;
  source: ShuffleDraftSource;
  /** Local path is always false. Polish may set true only when a provider was called. */
  networkUsed: boolean;
}

export interface DailyShuffle {
  day: string;
  suggestions: ReconnectSuggestion[];
}

export interface ShuffleBuildInput {
  people: ShuffleCardInput[];
  now?: Date;
  skipSlugs?: ReadonlySet<string>;
  limit?: number;
}

export function localDayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Note slugs append `Date.now().toString(36)`. Used only as a local recency hint. */
export function timestampFromNotePath(path: string): number | null {
  const base = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  const suffix = base.split("-").pop() ?? "";
  if (!/^[0-9a-z]+$/i.test(suffix) || suffix.length < 6) return null;
  const ms = Number.parseInt(suffix, 36);
  if (!Number.isFinite(ms) || ms < 1_000_000_000_000 || ms > Date.now() + 86_400_000) return null;
  return ms;
}

export function lastTouchMs(input: ShuffleCardInput): number | null {
  const times: number[] = [];
  for (const note of input.person.notes) {
    const fromPath = timestampFromNotePath(note.path);
    if (fromPath) times.push(fromPath);
  }
  const accepted = parseTime(input.lastAcceptedAt);
  if (accepted) times.push(accepted);
  const followRun = parseTime(input.follow?.lastRunAt);
  if (followRun) times.push(followRun);
  if (times.length) return Math.max(...times);
  if (input.person.notes.length) return 1;
  return null;
}

/**
 * Daily deck from local OKF notes / last-touch / follow already on disk.
 * Oldest last-touch first. Not a friend-ranker: no cloud score, no "who matters".
 */
export function buildDailyShuffle(input: ShuffleBuildInput): DailyShuffle {
  const now = input.now ?? new Date();
  const skip = input.skipSlugs ?? new Set<string>();
  const limit = input.limit ?? DAILY_RECONNECT_LIMIT;
  const ranked = input.people
    .filter((item) => item.person.slug && !skip.has(item.person.slug))
    .map((item) => ({ item, touch: lastTouchMs(item) ?? 0 }))
    .sort((a, b) => {
      if (a.touch !== b.touch) return a.touch - b.touch;
      return a.item.person.title.localeCompare(b.item.person.title);
    })
    .slice(0, Math.max(0, limit))
    .map(({ item }) => toSuggestion(item, now));

  return { day: localDayKey(now), suggestions: ranked };
}

export function buildLocalReconnectDraft(suggestion: ReconnectSuggestion): ReconnectDraft {
  const last = suggestion.lastNoteBody
    ? `Last note on disk — ${suggestion.lastNoteTitle || "Note"}: ${clip(suggestion.lastNoteBody)}`
    : "No notes on this card yet.";
  const follow = suggestion.followInterval
    ? `Follow is ${suggestion.followInterval} on this machine.`
    : "No follow schedule on this card.";
  const body = [
    `Hi ${suggestion.title} —`,
    "",
    `It's been ${suggestion.recencyLabel.toLowerCase()}.`,
    last,
    follow,
    "",
    "Want to catch up?",
    "",
    "_Drafted on this machine from the OKF card. Nothing was sent._",
  ].join("\n");
  return {
    slug: suggestion.slug,
    personTitle: suggestion.title,
    body,
    source: "local",
    networkUsed: false,
  };
}

export function applyPolishedReconnectDraft(
  draft: ReconnectDraft,
  text: string,
  networkUsed = false,
): ReconnectDraft {
  const body = text.trim() || draft.body;
  return {
    ...draft,
    body,
    source: "polished",
    networkUsed: draft.source === "local" ? networkUsed : draft.networkUsed || networkUsed,
  };
}

/** Demo / offline polish. Rewrites copy only — never fetches, never sends. */
export function demoPolishReconnectDraft(draft: ReconnectDraft): string {
  return draft.body.startsWith("Polish:") ? draft.body : `Polish: ${draft.body}`;
}

export function writesForAcceptedDraft(
  draft: ReconnectDraft,
): Extract<OkfWriteIntent, { type: "note" }> | null {
  const body = draft.body.trim();
  if (!body) return null;
  return {
    type: "note",
    slug: draft.slug,
    title: `Reconnect draft — ${draft.personTitle}`,
    body,
  };
}

/** Propose / skip / dismiss must never produce OKF write intents. */
export function shuffleProposeWrites(): never[] {
  return [];
}

export function skipShuffleWrites(): never[] {
  return [];
}

export function dismissShuffleWrites(): never[] {
  return [];
}

export function assertLocalShuffleNeedsNoNetwork(shuffle: DailyShuffle): void {
  const payload = JSON.stringify(shuffle);
  if (/api\.x\.ai|generativelanguage\.googleapis\.com|generativelanguage\.google\.com|auth\.x\.ai/i.test(payload)) {
    throw new Error("local shuffle must not mention live provider hosts");
  }
}

export function assertReconnectNeverSends(sends: unknown[]): void {
  if (sends.length > 0) {
    throw new Error("reconnect shuffle must not auto-send messages");
  }
}

export function assertNoGraphUpload(payload: string): void {
  if (/skuffen\.(cloud|api)|uploadGraph|people-graph\.json|multipart\/form-data/i.test(payload)) {
    throw new Error("reconnect must not upload the people-graph");
  }
}

/** Latch extra care: draft/prompt may include this one card, never a sibling. */
export function assertOnePersonOnly(payload: string, sibling: string): void {
  if (sibling && payload.includes(sibling)) {
    throw new Error("reconnect must not include sibling people or the full graph");
  }
}

export function assertNotAFriendRanker(shuffle: DailyShuffle): void {
  const json = JSON.stringify(shuffle);
  if (/friend-rank|who matters|pagerank|embedding|cloud.?scor|importance/i.test(json)) {
    throw new Error("shuffle must not ship a friend-ranker");
  }
  for (const item of shuffle.suggestions) {
    if ("score" in item || "rank" in item || "weight" in item) {
      throw new Error("shuffle suggestions must not carry a ranker score");
    }
  }
}

export function buildReconnectDraftPrompt(suggestion: ReconnectSuggestion): string {
  const last = suggestion.lastNoteBody
    ? `${suggestion.lastNoteTitle || "Note"}: ${suggestion.lastNoteBody}`
    : "(none)";
  const follow = suggestion.followInterval
    ? `${suggestion.followInterval} · next ${suggestion.followNextAt || "pending"}`
    : "(none)";
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Draft a short reconnect message for this one person.",
    "Use only the facts below. Do not invent people. Do not invent extra facts.",
    "Do not ask for or assume the rest of the people-graph.",
    "Do not include sibling cards. Do not send messages. Do not upload or request the full graph.",
    'Return ONLY JSON: {"draft":""}',
    `Name: ${suggestion.title}`,
    `Recency: ${suggestion.recencyLabel}`,
    `Last note:\n${last}`,
    `Follow:\n${follow}`,
  ].join("\n");
}

export function grokReconnectDraftRequest(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    temperature: 0.3,
    messages: [
      { role: "system", content: RECONNECT_SYSTEM },
      { role: "user", content: prompt },
    ],
  };
}

/** Search-free Gemini generate payload. Same reconnect constraints as Grok; no googleSearch. */
export function geminiReconnectDraftGenerate(prompt: string): {
  contents: string;
  config: { systemInstruction: string };
} {
  return {
    contents: prompt,
    config: { systemInstruction: RECONNECT_SYSTEM },
  };
}

/**
 * Live draft polish transport. ProvidersService must send these bodies —
 * never askGrok / RESEARCH_SYSTEM, never research tools, never a graph.
 */
export function liveReconnectDraftRequests(input: { grokModel: string; prompt: string }): {
  grok: { url: "https://api.x.ai/v1/chat/completions"; body: Record<string, unknown> };
  gemini: ReturnType<typeof geminiReconnectDraftGenerate>;
} {
  return {
    grok: {
      url: "https://api.x.ai/v1/chat/completions",
      body: grokReconnectDraftRequest(input.grokModel, input.prompt),
    },
    gemini: geminiReconnectDraftGenerate(input.prompt),
  };
}

export function parseReconnectDraft(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return "";
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { draft?: unknown };
    return typeof parsed.draft === "string" ? parsed.draft.trim() : "";
  } catch {
    return "";
  }
}

function toSuggestion(input: ShuffleCardInput, now: Date): ReconnectSuggestion {
  const person = input.person;
  const lastNote = person.notes[person.notes.length - 1];
  const touch = lastTouchMs(input);
  const recencyLabel = recencyFrom(touch, now);
  const reasons: ShuffleReason[] = [];

  if (lastNote) {
    reasons.push({
      id: `last-note-${person.slug}`,
      kind: "last-note",
      title: "Last note",
      body: `${lastNote.title}: ${clip(lastNote.body)}`,
    });
  } else {
    reasons.push({
      id: `last-note-${person.slug}`,
      kind: "last-note",
      title: "Last note",
      body: "None on this card yet.",
    });
  }

  if (input.lastAcceptedAt) {
    reasons.push({
      id: `last-accept-${person.slug}`,
      kind: "last-accept",
      title: "Last accept",
      body: input.lastAcceptedAt,
    });
  }

  if (input.follow?.enabled) {
    reasons.push({
      id: `follow-${person.slug}`,
      kind: "follow",
      title: "Follow schedule",
      body: `${input.follow.interval} · next ${input.follow.nextRunAt || "pending"}`,
    });
  }

  reasons.push({
    id: `recency-${person.slug}`,
    kind: "recency",
    title: "Recency",
    body: recencyLabel,
  });

  return {
    id: `shuffle-${person.slug}`,
    slug: person.slug,
    title: person.title,
    lastNoteTitle: lastNote?.title,
    lastNoteBody: lastNote ? clip(lastNote.body) : undefined,
    lastTouchAt: touch && touch > 1 ? new Date(touch).toISOString() : null,
    lastAcceptedAt: input.lastAcceptedAt ?? null,
    followInterval: input.follow?.enabled ? input.follow.interval : undefined,
    followNextAt: input.follow?.enabled ? input.follow.nextRunAt ?? null : undefined,
    recencyLabel,
    reasons,
  };
}

function recencyFrom(touch: number | null, now: Date): string {
  if (touch == null || touch === 0) return "Never touched on this card";
  if (touch === 1) return "Notes on disk, no timestamp";
  const days = Math.max(0, Math.floor((now.getTime() - touch) / 86_400_000));
  if (days === 0) return "Touched today";
  if (days === 1) return "1 day since last touch";
  return `${days} days since last touch`;
}

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function clip(value: string, max = 220): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
