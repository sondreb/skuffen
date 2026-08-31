import { normalizeTag } from "../../../packages/okf/src/index";
import type {
  FactSuggestion,
  FollowInterval,
  FollowRecord,
  NameResearchProposal,
  PersonField,
  PersonView,
  ProposedFact,
  StoredProposal,
} from "../models";

export const RESEARCH_SYSTEM =
  "You return compact JSON only. Search public web sources. Never request the full people-graph. Never invent people. Never invent contact details. Never draft or send messages.";

/** Shared by Research and name-to-research. Suggestions only — Accept is the write. */
export const WEBSITE_CONTACT_INSTRUCTION =
  "When a personal or main website is known or found (homepage, social URL, or search), read that public page and extract any email and phone published there. Propose those as field facts: kind field, field email or phone. Do not invent contact details that are not on the page.";

/** Same pages as contact. Prefer real page images. Never invent a face. */
export const WEBSITE_PHOTO_INSTRUCTION =
  "On that personal site, Wikipedia page, or other public page already in this research path, look for a real profile or headshot (og:image, portrait, about photo). Propose those as kind photo with a public http(s) image URL. Prefer real page images over generated or placeholder art. Do not invent a face. Skip favicons, apple-touch icons, and other tiny icons.";

const INTERVAL_MS: Record<FollowInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export type PersonPromptInput = Pick<
  PersonView,
  "slug" | "title" | "description" | "givenName" | "familyName" | "email" | "phone" | "body" | "notes" | "social"
>;

export type OkfWriteIntent =
  | { type: "note"; slug: string; title: string; body: string }
  | { type: "social"; slug: string; network: string; url: string; handle?: string }
  | { type: "field"; slug: string; field: PersonField; value: string }
  | { type: "photo"; slug: string; url: string; title?: string }
  | { type: "relation"; slug: string; relatedSlug: string; relationKind: NonNullable<FactSuggestion["relationKind"]>; relationRole: string }
  | {
      type: "place";
      slug: string;
      placeName: string;
      notes?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      placeRole?: NonNullable<FactSuggestion["placeRole"]>;
      placeSlug?: string;
    }
  | { type: "tag"; slug: string; tag: string };

export type PersonDraft = {
  title: string;
  description?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  body?: string;
};

export type NameAcceptPlan = {
  person: PersonDraft;
  extras: FactSuggestion[];
};

const PERSON_FIELDS = new Set<PersonField>([
  "title",
  "description",
  "body",
  "email",
  "phone",
  "givenName",
  "familyName",
]);

const SUGGESTION_SCHEMA =
  '{"suggestions":[{"kind":"note"|"social"|"field"|"photo"|"tag","title":"","body":"","network":"","url":"","handle":"","field":"title"|"description"|"body"|"email"|"phone"|"givenName"|"familyName","value":"","tag":""}]}';

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

function knownPublicPages(person: PersonPromptInput): string {
  const pages = person.social
    .map((item) => item.url?.trim())
    .filter((url): url is string => Boolean(url));
  if (pages.length === 0) return "(none — search for a personal or main website)";
  return pages.map((url) => `- ${url}`).join("\n");
}

export function buildResearchPrompt(person: PersonPromptInput): string {
  const notes = person.notes.map((n) => `- ${n.title}: ${n.body.slice(0, 280)}`).join("\n") || "(none)";
  const social =
    person.social.map((s) => `- ${s.network ?? "profile"} ${s.handle ?? ""} ${s.url ?? ""}`).join("\n") ||
    "(none)";
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Search the public web for current, sourced facts about this one person.",
    WEBSITE_CONTACT_INSTRUCTION,
    WEBSITE_PHOTO_INSTRUCTION,
    "Suggest at most 8 structured facts: email, phone, social URLs, about/bio, public profile photo URLs when a real page image is known, and at most one short local tag (kind tag, field tag) when a public page clearly indicates a label such as family or work.",
    "Results are suggestions only.",
    "Do not invent people. Do not create a new person. Do not ask for or assume the rest of the people-graph.",
    "Do not draft outreach. Do not send messages. Do not upload or request the full graph.",
    `Return ONLY JSON: ${SUGGESTION_SCHEMA}`,
    `Name: ${person.title}`,
    `Given name: ${person.givenName ?? ""}`,
    `Family name: ${person.familyName ?? ""}`,
    `Description: ${person.description ?? ""}`,
    `Existing email: ${person.email?.trim() || "(none)"}`,
    `Existing phone: ${person.phone?.trim() || "(none)"}`,
    `About:\n${person.body}`,
    `Existing notes:\n${notes}`,
    `Existing social:\n${social}`,
    `Known public pages:\n${knownPublicPages(person)}`,
  ].join("\n");
}

export function buildNameResearchPrompt(name: string): string {
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Search the public web for current, sourced facts about this one person.",
    "The only identifier you have is the name the user typed.",
    "If search finds a personal or main website, read that public page.",
    WEBSITE_CONTACT_INSTRUCTION,
    WEBSITE_PHOTO_INSTRUCTION,
    "Suggest structured facts: name, email, phone, social URLs, about/bio, public profile photo URLs, other contact facts.",
    "Use kind photo with a public http(s) image URL of a real page image. Do not scrape behind logins. Do not invent a face.",
    "Do not invent people. Do not invent additional people. Do not ask for or assume the rest of the people-graph.",
    "Do not invent contact details that are not published on a public page.",
    "Do not draft outreach. Do not send messages. Do not upload or request the full graph.",
    `Return ONLY JSON: ${SUGGESTION_SCHEMA}`,
    `Name: ${name.trim()}`,
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
    kind:
      item.kind === "social" ||
      item.kind === "field" ||
      item.kind === "photo" ||
      item.kind === "relation" ||
      item.kind === "place" ||
      item.kind === "tag"
        ? item.kind
        : "note",
    title: String(item.title ?? "Suggestion"),
    body: item.body,
    network: item.network,
    url: item.url,
    handle: item.handle,
    field: PERSON_FIELDS.has(item.field as PersonField) ? (item.field as PersonField) : undefined,
    value: item.value,
    relationKind: item.relationKind,
    relationRole: item.relationRole,
    relatedSlug: item.relatedSlug,
    placeName: item.placeName,
    placeSlug: item.placeSlug,
    address: item.address,
    latitude: item.latitude,
    longitude: item.longitude,
    placeRole: item.placeRole,
    tag: item.tag,
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
  if (suggestion.kind === "photo" && suggestion.url && isPublicHttpUrl(suggestion.url)) {
    return { type: "photo", slug, url: suggestion.url, title: suggestion.title };
  }
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
  if (suggestion.kind === "relation" && suggestion.relatedSlug && suggestion.relationKind && suggestion.relationRole) {
    return {
      type: "relation",
      slug,
      relatedSlug: suggestion.relatedSlug,
      relationKind: suggestion.relationKind,
      relationRole: suggestion.relationRole,
    };
  }
  if (suggestion.kind === "place" && (suggestion.placeName || suggestion.title)) {
    return {
      type: "place",
      slug,
      placeName: (suggestion.placeName || suggestion.title).trim(),
      notes: suggestion.body,
      address: suggestion.address,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      placeRole: suggestion.placeRole,
      placeSlug: suggestion.placeSlug,
    };
  }
  if (suggestion.kind === "tag") {
    const tag = normalizeTag(suggestion.tag || suggestion.title);
    if (tag) return { type: "tag", slug, tag };
  }
  return {
    type: "note",
    slug,
    title: suggestion.title,
    body: suggestion.body || suggestion.value || suggestion.title,
  };
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function photoFileNameFromUrl(url: string, stamp = "research"): string {
  let ext = "jpg";
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.(jpe?g|png|webp|gif)$/i);
    if (match) {
      const raw = match[1].toLowerCase();
      ext = raw === "jpeg" ? "jpg" : raw;
    }
  } catch {
    /* default jpg */
  }
  return `${stamp}.${ext}`;
}

export function keepFetchedPhoto(
  write: Extract<OkfWriteIntent, { type: "photo" }>,
  bytes: Uint8Array | null,
): { slug: string; url: string; title?: string; bytes: Uint8Array } | null {
  if (!bytes || bytes.byteLength === 0) return null;
  return { slug: write.slug, url: write.url, title: write.title, bytes };
}

/** Public http(s) image URL for a checkable proposal preview. Never a javascript: or data: URL. */
export function photoPreviewUrl(suggestion: Pick<FactSuggestion, "kind" | "url">): string | null {
  if (suggestion.kind !== "photo" || !suggestion.url) return null;
  return isPublicHttpUrl(suggestion.url) ? suggestion.url : null;
}

/** Fetch failures must skip the photo, not abort Accept. */
export async function readPublicPhotoBytes(
  url: string,
  fetchBytes: (url: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> {
  if (!isPublicHttpUrl(url)) return null;
  try {
    const bytes = await fetchBytes(url);
    return bytes && bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export function nameAcceptErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || "Could not save the proposed card.";
}

export function skippedPhotosNotice(count: number): string | null {
  if (count <= 0) return null;
  return `${count} photo${count === 1 ? "" : "s"} could not be fetched. The rest of the card was saved.`;
}

/** Name research stores an empty slug until Accept creates the person. */
export function attachStoredProposalSlug(
  proposals: StoredProposal[],
  query: string,
  slug: string,
): StoredProposal[] {
  const name = query.trim();
  const next = slug.trim();
  if (!name || !next) return proposals;
  return proposals.map((item) =>
    !item.slug && item.query === name && item.source === "research" ? { ...item, slug: next } : item,
  );
}

export function proposeNameResearch(query: string, suggestions: FactSuggestion[]): NameResearchProposal {
  const name = query.trim();
  const facts: ProposedFact[] = [];
  const hasTitle = suggestions.some((item) => item.kind === "field" && item.field === "title" && item.value?.trim());
  if (!hasTitle) {
    facts.push({
      id: "name-title",
      checked: true,
      suggestion: {
        id: "name-title",
        source: "research",
        kind: "field",
        field: "title",
        title: "Name",
        value: name,
      },
    });
  }
  for (const suggestion of suggestions) {
    facts.push({ id: suggestion.id, checked: true, suggestion });
  }
  return { query: name, facts };
}

export function setFactChecked(
  proposal: NameResearchProposal,
  id: string,
  checked: boolean,
): NameResearchProposal {
  return {
    ...proposal,
    facts: proposal.facts.map((fact) => (fact.id === id ? { ...fact, checked } : fact)),
  };
}

export function setAllFactsChecked(proposal: NameResearchProposal, checked: boolean): NameResearchProposal {
  return {
    ...proposal,
    facts: proposal.facts.map((fact) => ({ ...fact, checked })),
  };
}

export function deleteProposedFact(proposal: NameResearchProposal, id: string): NameResearchProposal {
  return {
    ...proposal,
    facts: proposal.facts.filter((fact) => fact.id !== id),
  };
}

export function checkedSuggestions(proposal: NameResearchProposal): FactSuggestion[] {
  return proposal.facts.filter((fact) => fact.checked).map((fact) => fact.suggestion);
}

export function personDraftFromAccepted(query: string, accepted: FactSuggestion[]): PersonDraft {
  const draft: PersonDraft = { title: query.trim() || "Untitled" };
  for (const item of accepted) {
    if (item.kind !== "field" || !item.field || !item.value?.trim()) continue;
    const value = item.value.trim();
    if (item.field === "title") draft.title = value;
    if (item.field === "description") draft.description = value;
    if (item.field === "givenName") draft.givenName = value;
    if (item.field === "familyName") draft.familyName = value;
    if (item.field === "email") draft.email = value;
    if (item.field === "phone") draft.phone = value;
    if (item.field === "body") draft.body = value;
  }
  return draft;
}

export function planAcceptedNameProposal(proposal: NameResearchProposal): NameAcceptPlan | null {
  const accepted = checkedSuggestions(proposal);
  if (accepted.length === 0) return null;
  return {
    person: personDraftFromAccepted(proposal.query, accepted),
    extras: accepted.filter((item) => item.kind !== "field"),
  };
}

export function dismissNameProposal(): NameAcceptPlan | null {
  return null;
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

/** Shown on Research / Suggest when no Grok or Gemini is connected. */
export const RESEARCH_NEEDS_PROVIDER =
  "Connect Grok or Gemini in Menu → Providers. There is no Skuffen cloud account.";

export function showResearchEmptyState(input: {
  requested: boolean;
  demoMode: boolean;
  hasProvider: boolean;
  busy: boolean;
  proposalCount: number;
}): boolean {
  return (
    input.requested &&
    !input.demoMode &&
    !input.hasProvider &&
    !input.busy &&
    input.proposalCount === 0
  );
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
