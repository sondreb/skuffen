import type { FactSuggestion, FollowRecord, PersonView, StoredProposal } from "../models";
import { wantedSummary } from "./memory";
import type { OkfWriteIntent } from "./research";

export const BRIEF_SYSTEM =
  "You rewrite talking points for a local pre-meeting brief. Use only the facts given. Never request the full people-graph. Never invent people. Never draft or send messages.";

export type BriefSource = "local" | "polished";

export interface MeetingEvent {
  title?: string;
  when?: string;
  where?: string;
  notes?: string;
}

export interface BriefLine {
  id: string;
  kind: "who" | "event" | "note" | "follow-up" | "talking-point" | "place" | "social" | "pending";
  title: string;
  body: string;
}

export interface MeetingBrief {
  slug: string;
  personTitle: string;
  event: MeetingEvent;
  source: BriefSource;
  who: string;
  lastNotes: BriefLine[];
  followUps: BriefLine[];
  talkingPoints: BriefLine[];
  place?: BriefLine;
  social: BriefLine[];
  pending: BriefLine[];
  markdown: string;
  /** Local path is always false. Polish may set true only when a provider was called. */
  networkUsed: boolean;
}

export interface LocalBriefInput {
  person: PersonView;
  proposals?: StoredProposal[];
  follow?: FollowRecord | null;
  event?: MeetingEvent;
}

const DEFAULT_ABOUT = /^# About\n\nNotes and social links for .+ live beside this document\.\s*$/;

const WHEN_RE =
  /\b(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}-\d{2}-\d{2})\b/i;

const WHERE_RE = /\b(@|at |café|cafe|park|office|zoom|meet|room|hall|street|avenue)\b/i;

export function parseEventPaste(text: string): MeetingEvent {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};

  const labeled = (prefix: RegExp): string | undefined => {
    const hit = lines.find((line) => prefix.test(line));
    return hit?.replace(prefix, "").trim() || undefined;
  };

  const title = labeled(/^title\s*[:—-]\s*/i) || lines[0];
  const when = labeled(/^when\s*[:—-]\s*/i) || lines.find((line) => line !== title && WHEN_RE.test(line));
  const where =
    labeled(/^where\s*[:—-]\s*/i) ||
    lines.find((line) => line !== title && line !== when && WHERE_RE.test(line));
  const notes = lines
    .filter((line) => line !== title && line !== when && line !== where)
    .join("\n");

  return {
    title,
    when,
    where,
    notes: notes || undefined,
  };
}

export function buildLocalBrief(input: LocalBriefInput): MeetingBrief {
  const person = input.person;
  const event = normalizeEvent(input.event);
  const pending = pendingLines(person, input.proposals ?? []);
  const lastNotes = noteLines(person);
  const social = socialLines(person);
  const place = placeLine(person);
  const followUps = followUpLines(person, pending, input.follow ?? null, event);
  const talkingPoints = talkingPointLines({ person, event, lastNotes, pending, follow: input.follow ?? null, place, social });
  const who = whoLine(person);

  const draft: Omit<MeetingBrief, "markdown"> = {
    slug: person.slug,
    personTitle: person.title,
    event,
    source: "local",
    who,
    lastNotes,
    followUps,
    talkingPoints,
    place,
    social,
    pending,
    networkUsed: false,
  };

  return { ...draft, markdown: renderBriefMarkdown(draft) };
}

export function renderBriefMarkdown(brief: Omit<MeetingBrief, "markdown">): string {
  const lines: string[] = [`# Pre-meeting brief — ${brief.personTitle}`, ""];

  if (brief.event.title || brief.event.when || brief.event.where) {
    lines.push("## Event");
    if (brief.event.title) lines.push(`- ${brief.event.title}`);
    if (brief.event.when) lines.push(`- When: ${brief.event.when}`);
    if (brief.event.where) lines.push(`- Where: ${brief.event.where}`);
    if (brief.event.notes) lines.push(`- ${brief.event.notes}`);
    lines.push("");
  }

  lines.push("## Who", brief.who, "");

  lines.push("## Last notes");
  if (brief.lastNotes.length === 0) {
    lines.push("- (none on disk)");
  } else {
    for (const note of brief.lastNotes) {
      lines.push(`- **${note.title}:** ${note.body}`);
    }
  }
  lines.push("");

  lines.push("## Open follow-ups");
  if (brief.followUps.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of brief.followUps) {
      lines.push(`- **${item.title}:** ${item.body}`);
    }
  }
  lines.push("");

  if (brief.place) {
    lines.push("## Place", `- ${brief.place.body}`, "");
  }

  if (brief.social.length) {
    lines.push("## Social");
    for (const item of brief.social) {
      lines.push(`- ${item.body}`);
    }
    lines.push("");
  }

  lines.push("## Talking points");
  if (brief.talkingPoints.length === 0) {
    lines.push("- (nothing local to suggest)");
  } else {
    for (const point of brief.talkingPoints) {
      lines.push(`- ${point.body}`);
    }
  }
  lines.push("");
  lines.push("_Assembled on this machine from the OKF card. Nothing was sent._");
  return lines.join("\n");
}

export function applyPolishedTalkingPoints(brief: MeetingBrief, points: string[], networkUsed = false): MeetingBrief {
  const talkingPoints = points
    .map((body) => body.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((body, index) => ({
      id: `talk-polished-${index + 1}`,
      kind: "talking-point" as const,
      title: "Talking point",
      body,
    }));
  const next: Omit<MeetingBrief, "markdown"> = {
    ...brief,
    source: "polished",
    talkingPoints: talkingPoints.length ? talkingPoints : brief.talkingPoints,
    networkUsed: brief.source === "local" ? networkUsed : brief.networkUsed || networkUsed,
  };
  return { ...next, markdown: renderBriefMarkdown(next) };
}

/** Demo / offline polish. Rewrites copy only — never fetches. */
export function demoPolishTalkingPoints(brief: MeetingBrief): string[] {
  return brief.talkingPoints.map((point) =>
    point.body.startsWith("Polish:") ? point.body : `Polish: ${point.body}`,
  );
}

export function writesForAcceptedBrief(brief: MeetingBrief): Extract<OkfWriteIntent, { type: "note" }> {
  const eventTitle = brief.event.title?.trim();
  return {
    type: "note",
    slug: brief.slug,
    title: eventTitle ? `Pre-meeting brief — ${eventTitle}` : `Pre-meeting brief — ${brief.personTitle}`,
    body: brief.markdown,
  };
}

/** Propose-only: generating a brief must never produce OKF write intents. */
export function briefProposeWrites(): never[] {
  return [];
}

export function assertLocalBriefNeedsNoNetwork(brief: MeetingBrief): void {
  if (brief.source === "local" && brief.networkUsed) {
    throw new Error("local brief must not use the network");
  }
  if (brief.source === "local") {
    const hosts = /api\.x\.ai|generativelanguage\.googleapis\.com|generativelanguage\.google\.com|auth\.x\.ai/i;
    if (hosts.test(brief.markdown) || hosts.test(brief.who)) {
      throw new Error("local brief must not mention live provider hosts");
    }
  }
}

const MAIL_INGEST =
  /gmail|imap\b|smtp\b|pop3|calendar\.google|googleapis\.com\/calendar|microsoft\.graph|outlook\.office|ews\/exchange/i;

/** Latch extra care: event context is paste-only. No mailbox or calendar ingest. */
export function assertNoMailIngest(payload: string): void {
  if (MAIL_INGEST.test(payload)) {
    throw new Error("brief must not ingest mail or cloud calendar");
  }
}

/** Latch extra care: polish/local brief may include this one card, never a sibling. */
export function assertOneCardOnly(payload: string, sibling: string): void {
  if (sibling && payload.includes(sibling)) {
    throw new Error("brief must not include sibling people or the full graph");
  }
}

export function buildPolishPrompt(brief: MeetingBrief): string {
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Rewrite talking points for a pre-meeting brief about this one person.",
    "Use only the facts below. Do not invent people. Do not invent extra facts.",
    "Do not ask for or assume the rest of the people-graph.",
    "Do not draft outreach. Do not send messages. Do not upload or request the full graph.",
    'Return ONLY JSON: {"talkingPoints":["",""]}',
    `Name: ${brief.personTitle}`,
    `Who:\n${brief.who}`,
    `Brief:\n${brief.markdown}`,
  ].join("\n");
}

export function grokPolishRequest(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    temperature: 0.3,
    messages: [
      { role: "system", content: BRIEF_SYSTEM },
      { role: "user", content: prompt },
    ],
  };
}

/** Search-free Gemini generate payload. Same brief constraints as Grok; no googleSearch. */
export function geminiPolishGenerate(prompt: string): {
  contents: string;
  config: { systemInstruction: string };
} {
  return {
    contents: prompt,
    config: { systemInstruction: BRIEF_SYSTEM },
  };
}

/**
 * Live polish transport. ProvidersService must send these bodies —
 * never askGrok / RESEARCH_SYSTEM, never research tools.
 */
export function livePolishRequests(input: { grokModel: string; prompt: string }): {
  grok: { url: "https://api.x.ai/v1/chat/completions"; body: Record<string, unknown> };
  gemini: ReturnType<typeof geminiPolishGenerate>;
} {
  return {
    grok: {
      url: "https://api.x.ai/v1/chat/completions",
      body: grokPolishRequest(input.grokModel, input.prompt),
    },
    gemini: geminiPolishGenerate(input.prompt),
  };
}

export function parsePolishedPoints(text: string): string[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { talkingPoints?: unknown };
    if (!Array.isArray(parsed.talkingPoints)) return [];
    return parsed.talkingPoints
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function normalizeEvent(event?: MeetingEvent): MeetingEvent {
  if (!event) return {};
  return {
    title: event.title?.trim() || undefined,
    when: event.when?.trim() || undefined,
    where: event.where?.trim() || undefined,
    notes: event.notes?.trim() || undefined,
  };
}

function whoLine(person: PersonView): string {
  const bits = [person.title];
  if (person.description) bits.push(person.description);
  const names = [person.givenName, person.familyName].filter(Boolean).join(" ");
  if (names && names !== person.title) bits.push(names);
  if (person.email) bits.push(person.email);
  if (person.phone) bits.push(person.phone);
  const about = person.body.trim();
  if (about && !DEFAULT_ABOUT.test(about)) {
    bits.push(clip(about, 240));
  }
  return bits.join("\n");
}

function noteLines(person: PersonView): BriefLine[] {
  return person.notes.slice(-5).map((note, index) => ({
    id: `note-${index}-${note.id}`,
    kind: "note" as const,
    title: note.title,
    body: clip(note.body),
  }));
}

function socialLines(person: PersonView): BriefLine[] {
  return person.social.map((item, index) => ({
    id: `social-${index}-${item.id}`,
    kind: "social" as const,
    title: item.network || item.title,
    body: [item.network, item.handle, item.url].filter(Boolean).join(" ") || item.title,
  }));
}

function placeLine(person: PersonView): BriefLine | undefined {
  const location = person.location;
  if (!location) return undefined;
  const address = location.address || location.title;
  return {
    id: "place",
    kind: "place",
    title: "Place",
    body: `${address} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`,
  };
}

function pendingLines(person: PersonView, proposals: StoredProposal[]): BriefLine[] {
  const mine = proposals.filter((item) => item.slug === person.slug);
  const out: BriefLine[] = [];
  for (const proposal of mine) {
    for (const suggestion of proposal.suggestions) {
      out.push({
        id: `pending-${suggestion.id}`,
        kind: "pending",
        title: suggestion.title,
        body: wantedSummary(suggestion),
      });
    }
  }
  return out;
}

function followUpLines(
  person: PersonView,
  pending: BriefLine[],
  follow: FollowRecord | null,
  event: MeetingEvent,
): BriefLine[] {
  const out: BriefLine[] = [];
  if (follow?.enabled) {
    out.push({
      id: `follow-${person.slug}`,
      kind: "follow-up",
      title: "Follow schedule",
      body: `${follow.interval} · next ${follow.nextRunAt || "pending"}`,
    });
  }
  for (const item of pending) {
    out.push({
      id: `followup-${item.id}`,
      kind: "follow-up",
      title: item.title,
      body: item.body,
    });
  }
  if (event.notes) {
    out.push({
      id: "event-notes",
      kind: "follow-up",
      title: "Event note",
      body: event.notes,
    });
  }
  return out;
}

function talkingPointLines(input: {
  person: PersonView;
  event: MeetingEvent;
  lastNotes: BriefLine[];
  pending: BriefLine[];
  follow: FollowRecord | null;
  place?: BriefLine;
  social: BriefLine[];
}): BriefLine[] {
  const points: BriefLine[] = [];
  const add = (title: string, body: string) => {
    points.push({ id: `talk-${points.length + 1}`, kind: "talking-point", title, body });
  };

  if (input.event.title) add("Agenda", `Walk through ${input.event.title}.`);
  if (input.event.when) add("When", `Confirm the time: ${input.event.when}.`);
  if (input.event.where) add("Where", `Confirm the place: ${input.event.where}.`);
  else if (input.place) add("Place", `Confirm the pin: ${input.place.body}.`);

  for (const note of input.lastNotes) {
    add(`Last note: ${note.title}`, `Ask about: ${note.body}`);
  }
  for (const pending of input.pending) {
    add(`Open proposal: ${pending.title}`, `Review before the meeting: ${pending.body}`);
  }
  if (input.follow?.enabled) {
    add("Follow", `This person is followed ${input.follow.interval}. Next check ${input.follow.nextRunAt || "pending"}.`);
  }
  for (const social of input.social) {
    add(`Thread: ${social.title}`, `Mention ${social.body}.`);
  }
  if (input.person.description) {
    add("How you know them", `Remember: ${input.person.description}.`);
  }

  return points.slice(0, 8);
}

function clip(value: string, max = 280): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
