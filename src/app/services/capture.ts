import type { FactSuggestion, PersonView } from "../models";
import type { PersonDraft } from "./research";

export const CAPTURE_SYSTEM =
  "You extract people, dates, and follow-ups from one capture. Use only that capture. Never request the full people-graph. Never invent people who are not mentioned. Never draft or send messages.";

export const CAPTURE_NEEDS_PROVIDER =
  "Connect Grok or Gemini in Latch → Providers. There is no Skuffen cloud account.";

/** Paste used by `?demo=1`. Synthetic — not a real conversation. */
export const DEMO_CAPTURE_NOTE =
  "Met Ada Demo at Golden Gate Park Tuesday. Follow up about the land-plot.";

export type CaptureKind = "person" | "date" | "follow-up" | "note";
export type CaptureSource = "paste" | "mic";

export interface CaptureItem {
  id: string;
  kind: CaptureKind;
  title: string;
  body: string;
  when?: string;
  personTitle?: string;
  email?: string;
  phone?: string;
  description?: string;
}

export interface ProposedCapture {
  id: string;
  checked: boolean;
  item: CaptureItem;
}

export interface CaptureProposal {
  note: string;
  source: CaptureSource;
  items: ProposedCapture[];
}

export interface CapturePersonDraft extends PersonDraft {
  title: string;
}

export interface CaptureNoteWrite {
  personTitle: string;
  title: string;
  body: string;
}

export interface CaptureAcceptPlan {
  people: CapturePersonDraft[];
  notes: CaptureNoteWrite[];
}

export type CaptureWriteIntent =
  | { type: "person"; title: string; description?: string; email?: string; phone?: string; body?: string }
  | { type: "note"; personTitle: string; title: string; body: string };

const CAPTURE_SCHEMA =
  '{"people":[{"name":"","description":"","email":"","phone":""}],"dates":[{"when":"","what":"","person":""}],"followUps":[{"title":"","body":"","person":"","when":""}]}';

const WEEKDAY_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
const FORBIDDEN_STT =
  /openai\.com\/v1\/audio|api\.deepgram|api\.assemblyai|speechmatics|rev\.ai|speech\.googleapis\.com|whisper\.api/i;
const LIVE_AI_HOSTS = /api\.x\.ai|generativelanguage\.googleapis\.com|generativelanguage\.google\.com|auth\.x\.ai/i;
const GRAPH_LEAK = /people\/[a-z0-9-]+\/person|Existing notes:|Existing social:|full people-graph dump/i;

export function buildCapturePrompt(note: string): string {
  const capture = note.trim();
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Turn this one voice or text capture into structured people, dates, and follow-ups.",
    "Use only the capture below. Do not ask for or assume the rest of the people-graph.",
    "Do not invent people who are not mentioned. Do not draft outreach. Do not send messages.",
    "Do not upload or request the full graph.",
    `Return ONLY JSON: ${CAPTURE_SCHEMA}`,
    `Capture:\n${capture}`,
  ].join("\n");
}

export function demoCapturePrompt(note: string): string {
  return `${buildCapturePrompt(note.trim() || DEMO_CAPTURE_NOTE)}\n(demo — no live provider call)`;
}

export function grokCaptureRequest(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: CAPTURE_SYSTEM },
      { role: "user", content: prompt },
    ],
  };
}

export function geminiCaptureGenerate(prompt: string): {
  contents: string;
  config: { systemInstruction: string };
} {
  return {
    contents: prompt,
    config: { systemInstruction: CAPTURE_SYSTEM },
  };
}

/**
 * Live capture transport. ProvidersService must send these bodies —
 * never askGrok / RESEARCH_SYSTEM, never research tools, never audio bytes.
 */
export function liveCaptureRequests(input: { grokModel: string; prompt: string }): {
  grok: { url: "https://api.x.ai/v1/chat/completions"; body: Record<string, unknown> };
  gemini: ReturnType<typeof geminiCaptureGenerate>;
} {
  return {
    grok: {
      url: "https://api.x.ai/v1/chat/completions",
      body: grokCaptureRequest(input.grokModel, input.prompt),
    },
    gemini: geminiCaptureGenerate(input.prompt),
  };
}

export function parseCaptureItems(text: string, note: string, stamp = Date.now()): CaptureItem[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const items: CaptureItem[] = [];
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        people?: Array<{ name?: string; title?: string; description?: string; email?: string; phone?: string }>;
        dates?: Array<{ when?: string; what?: string; title?: string; person?: string }>;
        followUps?: Array<{ title?: string; body?: string; person?: string; when?: string }>;
      };
      for (const [index, person] of (parsed.people ?? []).entries()) {
        const title = String(person.name ?? person.title ?? "").trim();
        if (!title) continue;
        items.push({
          id: `capture-person-${stamp}-${index}`,
          kind: "person",
          title,
          body: person.description?.trim() || `${title} mentioned in this capture.`,
          description: person.description?.trim() || undefined,
          email: person.email?.trim() || undefined,
          phone: person.phone?.trim() || undefined,
        });
      }
      for (const [index, date] of (parsed.dates ?? []).entries()) {
        const when = String(date.when ?? "").trim();
        const what = String(date.what ?? date.title ?? "").trim();
        if (!when && !what) continue;
        const title = when ? `Date — ${when}` : `Date — ${what}`;
        items.push({
          id: `capture-date-${stamp}-${index}`,
          kind: "date",
          title,
          body: [when, what].filter(Boolean).join(" — ") || title,
          when: when || undefined,
          personTitle: date.person?.trim() || undefined,
        });
      }
      for (const [index, follow] of (parsed.followUps ?? []).entries()) {
        const title = String(follow.title ?? "").trim() || "Follow-up";
        const body = String(follow.body ?? title).trim();
        items.push({
          id: `capture-follow-${stamp}-${index}`,
          kind: "follow-up",
          title: title.startsWith("Follow-up") ? title : `Follow-up — ${title}`,
          body,
          when: follow.when?.trim() || undefined,
          personTitle: follow.person?.trim() || undefined,
        });
      }
    } catch {
      /* fall through to note-only */
    }
  }
  const capture = note.trim();
  if (capture) {
    items.push({
      id: `capture-note-${stamp}`,
      kind: "note",
      title: "Voice note",
      body: capture,
      personTitle: items.find((item) => item.kind === "person")?.title,
    });
  }
  return items;
}

/** Demo / offline structure. No mic. No network. Uses only this capture. */
export function demoCaptureItems(note: string, stamp = 1): CaptureItem[] {
  const text = note.trim() || DEMO_CAPTURE_NOTE;
  const personTitle = /Ada Demo/i.test(text) ? "Ada Demo" : firstMentionedName(text) || "Ada Demo";
  const whenMatch = text.match(WEEKDAY_RE) ?? text.match(ISO_DATE_RE);
  const when = whenMatch ? capitalize(whenMatch[0]) : "Tuesday";
  const followMatch = text.match(/follow[\s-]*up(?: about)?\s+([^.]+)/i);
  const followWhat = followMatch?.[1]?.trim().replace(/\.$/, "") || "the park pin";
  return [
    {
      id: `demo-capture-person-${stamp}`,
      kind: "person",
      title: personTitle,
      body: "Mentioned in this capture (demo).",
      description: personTitle === "Ada Demo" ? "Synthetic demo card — not a real person" : undefined,
    },
    {
      id: `demo-capture-date-${stamp}`,
      kind: "date",
      title: `Date — ${when}`,
      body: text.slice(0, 220),
      when,
      personTitle,
    },
    {
      id: `demo-capture-follow-${stamp}`,
      kind: "follow-up",
      title: `Follow-up — ${followWhat}`,
      body: `Follow up about ${followWhat}.`,
      personTitle,
    },
    {
      id: `demo-capture-note-${stamp}`,
      kind: "note",
      title: "Voice note (demo)",
      body: text,
      personTitle,
    },
  ];
}

export function proposeCapture(note: string, items: CaptureItem[], source: CaptureSource = "paste"): CaptureProposal {
  return {
    note: note.trim(),
    source,
    items: items.map((item) => ({ id: item.id, checked: true, item })),
  };
}

export function setCaptureChecked(proposal: CaptureProposal, id: string, checked: boolean): CaptureProposal {
  return {
    ...proposal,
    items: proposal.items.map((entry) => (entry.id === id ? { ...entry, checked } : entry)),
  };
}

export function setAllCaptureChecked(proposal: CaptureProposal, checked: boolean): CaptureProposal {
  return {
    ...proposal,
    items: proposal.items.map((entry) => ({ ...entry, checked })),
  };
}

export function deleteCaptureItem(proposal: CaptureProposal, id: string): CaptureProposal {
  return {
    ...proposal,
    items: proposal.items.filter((entry) => entry.id !== id),
  };
}

export function checkedCaptureItems(proposal: CaptureProposal): CaptureItem[] {
  return proposal.items.filter((entry) => entry.checked).map((entry) => entry.item);
}

/** Propose-only: structuring a capture must never produce OKF write intents. */
export function captureProposeWrites(): never[] {
  return [];
}

export function dismissCaptureProposal(): CaptureAcceptPlan | null {
  return null;
}

export function planAcceptedCapture(
  proposal: CaptureProposal,
  fallbackPersonTitle?: string,
): CaptureAcceptPlan | null {
  const accepted = checkedCaptureItems(proposal);
  if (accepted.length === 0) return null;

  const people: CapturePersonDraft[] = [];
  const notes: CaptureNoteWrite[] = [];
  const defaultTitle =
    accepted.find((item) => item.kind === "person")?.title ||
    accepted.find((item) => item.personTitle)?.personTitle ||
    fallbackPersonTitle?.trim() ||
    "";

  for (const item of accepted) {
    if (item.kind === "person") {
      if (!people.some((person) => sameTitle(person.title, item.title))) {
        people.push({
          title: item.title,
          description: item.description,
          email: item.email,
          phone: item.phone,
          body: item.body,
        });
      }
      continue;
    }
    const personTitle = item.personTitle?.trim() || defaultTitle;
    if (!personTitle) continue;
    ensurePerson(people, personTitle);
    notes.push({
      personTitle,
      title: item.title,
      body: item.when && item.kind === "date" ? `${item.when}\n\n${item.body}` : item.body,
    });
  }

  if (people.length === 0 && notes.length === 0) return null;
  return { people, notes };
}

export function writesForAcceptedCapture(plan: CaptureAcceptPlan): CaptureWriteIntent[] {
  return [
    ...plan.people.map(
      (person): CaptureWriteIntent => ({
        type: "person",
        title: person.title,
        description: person.description,
        email: person.email,
        phone: person.phone,
        body: person.body,
      }),
    ),
    ...plan.notes.map(
      (note): CaptureWriteIntent => ({
        type: "note",
        personTitle: note.personTitle,
        title: note.title,
        body: note.body,
      }),
    ),
  ];
}

export function resolveCaptureNoteSlug(
  personTitle: string,
  people: ReadonlyArray<Pick<PersonView, "slug" | "title">>,
): string | undefined {
  const hit = people.find((person) => sameTitle(person.title, personTitle));
  return hit?.slug;
}

export function captureItemsAsSuggestions(items: CaptureItem[]): FactSuggestion[] {
  return items.map((item) => ({
    id: item.id,
    source: "capture",
    kind: item.kind === "person" ? "field" : "note",
    field: item.kind === "person" ? "title" : undefined,
    title: item.title,
    body: item.body,
    value: item.kind === "person" ? item.title : item.body,
  }));
}

export function captureLabel(item: CaptureItem): string {
  if (item.kind === "person") {
    return [item.description, item.email, item.phone, item.body].filter(Boolean).join(" · ") || item.title;
  }
  if (item.when) return `${item.when} — ${item.body}`;
  return item.body || item.title;
}

export function speechRecognitionAvailable(
  host: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } = globalThis as typeof globalThis & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  },
): boolean {
  return Boolean(host.SpeechRecognition || host.webkitSpeechRecognition);
}

/** Drop mic session objects. Capture must never keep audio bytes. */
export function dropCaptureAudio<T extends { stop?: () => void; abort?: () => void; stream?: { getTracks: () => Array<{ stop: () => void }> } }>(
  session: T | null,
): null {
  try {
    session?.stream?.getTracks().forEach((track) => track.stop());
  } catch {
    /* already gone */
  }
  try {
    session?.stop?.();
  } catch {
    /* already gone */
  }
  try {
    session?.abort?.();
  } catch {
    /* already gone */
  }
  return null;
}

export function transcriptFromSpeechResults(
  results: ArrayLike<ArrayLike<{ transcript?: string }>>,
): string {
  const last = results[results.length - 1];
  if (!last) return "";
  return Array.from(last)
    .map((part) => part.transcript ?? "")
    .join("")
    .trim();
}

export function assertCapturePromptIsCaptureOnly(prompt: string, sibling = "Bob Example"): void {
  if (!prompt.includes("Capture:")) {
    throw new Error("capture prompt must include only this capture");
  }
  if (prompt.includes(sibling) || GRAPH_LEAK.test(prompt)) {
    throw new Error("capture prompt must not include the people-graph");
  }
}

export function assertNoThirdPartyStt(payload: string): void {
  if (FORBIDDEN_STT.test(payload)) {
    throw new Error("capture must not add a third-party STT vendor");
  }
}

export function assertNoAudioPersist(store: { audio?: unknown; blobs?: unknown[] }): void {
  if (store.audio != null && store.audio !== "") {
    throw new Error("capture must not persist audio");
  }
  if (store.blobs && store.blobs.length > 0) {
    throw new Error("capture must not persist audio blobs");
  }
}

export function assertDemoCaptureNeedsNoNetwork(payload: string): void {
  if (LIVE_AI_HOSTS.test(payload)) {
    throw new Error("demo capture must not call live provider hosts");
  }
}

export function showCaptureEmptyState(input: {
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

function ensurePerson(people: CapturePersonDraft[], title: string): void {
  if (!people.some((person) => sameTitle(person.title, title))) {
    people.push({ title });
  }
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function firstMentionedName(text: string): string | undefined {
  const hit = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/);
  return hit?.[1];
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}
