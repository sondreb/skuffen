import type { PersonView } from "../models";
import type { OkfWriteIntent } from "./research";

export const COMMITMENTS_EMPTY = "No commitments yet.";

export const COMMITMENT_TITLE_PREFIX = "Commitment — ";
export const COMMITMENT_DONE_PREFIX = "Done — ";

export const COMMITMENT_SYSTEM =
  "You extract promises the user made to one person. Use only the note or capture given. Never request the full people-graph. Never invent people. Never send messages. Never email or SMS.";

export type CommitmentStatus = "open" | "done" | "dropped";
export type CommitmentProposalSource = "capture" | "note";

export interface CommitmentRow {
  /** Bundle-relative OKF path. File path is identity. */
  id: string;
  slug: string;
  personTitle: string;
  what: string;
  /** Local calendar day only: YYYY-MM-DD. */
  dueDate?: string;
  status: CommitmentStatus;
  sourcePath: string;
  at?: string;
}

export interface ProposedCommitment {
  id: string;
  checked: boolean;
  slug: string;
  personTitle: string;
  what: string;
  dueDate?: string;
  sourcePath?: string;
  sourceText: string;
}

export interface CommitmentProposal {
  source: CommitmentProposalSource;
  slug: string;
  personTitle: string;
  items: ProposedCommitment[];
}

export interface CommitmentListInput {
  people: PersonView[];
  droppedIds?: readonly string[];
  includeDone?: boolean;
}

const SKIP_NOTE_TITLE =
  /^(Reconnect draft|Brief|Pre-meeting brief|Voice note|Follow-up|Date —|Done —)/i;

const PROMISE_RES: RegExp[] = [
  /\bI promised (?:to |I'd |I would )?([^.;\n]+)/gi,
  /\b(?:I )?told (?:\S+(?: \S+)?) I(?:'d| would) ([^.;\n]+)/gi,
  /\bI said I(?:'d| would) ([^.;\n]+)/gi,
  /\bI(?:'ll| will) ([^.;\n]+)/gi,
  /\bI owe (?:them|her|him|you) ([^.;\n]+)/gi,
];

const DUE_RE = /\b(?:due:?|by|on)\s+(\d{4}-\d{2}-\d{2})\b/i;
const DUE_LINE_RE = /^Due:\s*(\d{4}-\d{2}-\d{2})(?:\s+\(local\))?/im;

const LIVE_AI = /api\.x\.ai|generativelanguage\.googleapis\.com|generativelanguage\.google\.com|auth\.x\.ai/i;
const GRAPH_UPLOAD = /skuffen\.(cloud|api)|uploadGraph|people-graph\.json|multipart\/form-data/i;
const SEND_LEAK = /mailto:|sms:|auto-send|sendMessage|auto-dm|auto-email/i;

export function isLocalDueDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function commitmentTitle(what: string): string {
  return `${COMMITMENT_TITLE_PREFIX}${what.trim()}`;
}

export function doneTitle(what: string): string {
  return `${COMMITMENT_DONE_PREFIX}${what.trim()}`;
}

export function isCommitmentNoteTitle(title: string): boolean {
  return title.trim().startsWith(COMMITMENT_TITLE_PREFIX);
}

export function isDoneCommitmentTitle(title: string): boolean {
  return title.trim().startsWith(COMMITMENT_DONE_PREFIX);
}

export function whatFromCommitmentTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.startsWith(COMMITMENT_TITLE_PREFIX)) {
    return trimmed.slice(COMMITMENT_TITLE_PREFIX.length).trim();
  }
  if (trimmed.startsWith(COMMITMENT_DONE_PREFIX)) {
    return trimmed.slice(COMMITMENT_DONE_PREFIX.length).trim();
  }
  return trimmed;
}

export function parseDueDate(body: string): string | undefined {
  const line = body.match(DUE_LINE_RE)?.[1];
  if (line && isLocalDueDate(line)) return line;
  const inline = body.match(DUE_RE)?.[1];
  return inline && isLocalDueDate(inline) ? inline : undefined;
}

export function extractPromises(text: string): Array<{ what: string; dueDate?: string }> {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [];
  const dueDate = parseDueDate(source);
  const found: Array<{ what: string; dueDate?: string }> = [];
  const seen = new Set<string>();

  for (const pattern of PROMISE_RES) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const what = cleanWhat(match[1] ?? "", dueDate);
      const key = what.toLowerCase();
      if (!what || seen.has(key)) continue;
      seen.add(key);
      found.push(dueDate ? { what, dueDate } : { what });
    }
  }

  return found;
}

export function commitmentNoteBody(input: { what: string; dueDate?: string }): string {
  const lines = [input.what.trim(), ""];
  if (input.dueDate && isLocalDueDate(input.dueDate)) {
    lines.push(`Due: ${input.dueDate} (local)`, "");
  }
  lines.push("_Promised on this machine. Nothing was sent._");
  return lines.join("\n");
}

export function doneNoteBody(what: string): string {
  return [`Marked done on this machine. Nothing was sent.`, "", `Was: ${what.trim()}`].join("\n");
}

/**
 * Open commitments already Accepted onto OKF cards.
 * File path is identity. Dropped ids live in local settings, not OKF.
 */
export function buildCommitmentList(input: CommitmentListInput): CommitmentRow[] {
  const dropped = new Set(input.droppedIds ?? []);
  const rows: CommitmentRow[] = [];

  for (const person of input.people) {
    if (!person.slug) continue;
    const doneWhats = new Set(
      person.notes.filter((note) => isDoneCommitmentTitle(note.title)).map((note) => whatFromCommitmentTitle(note.title).toLowerCase()),
    );

    for (const note of person.notes) {
      if (!isCommitmentNoteTitle(note.title)) continue;
      const path = note.path || note.id;
      const what = whatFromCommitmentTitle(note.title);
      if (!what) continue;
      const dueDate = parseDueDate(note.body);
      const droppedRow = dropped.has(path);
      const done = doneWhats.has(what.toLowerCase());
      const status: CommitmentStatus = droppedRow ? "dropped" : done ? "done" : "open";
      if (status === "dropped") continue;
      if (status === "done" && !input.includeDone) continue;
      rows.push({
        id: path,
        slug: person.slug,
        personTitle: person.title,
        what,
        dueDate,
        status,
        sourcePath: path,
        at: note.at,
      });
    }
  }

  return rows.sort(byDueThenWhat);
}

export function proposeCommitmentsFromText(
  person: PersonView,
  text: string,
  source: CommitmentProposalSource = "capture",
): CommitmentProposal {
  const items = extractPromises(text).map((item, index) => toProposed(person, item, source, index, text));
  return { source, slug: person.slug, personTitle: person.title, items };
}

export function proposeCommitmentsFromNote(
  person: PersonView,
  note: { path: string; title: string; body: string },
): CommitmentProposal {
  if (isCommitmentNoteTitle(note.title) || isDoneCommitmentTitle(note.title)) {
    return { source: "note", slug: person.slug, personTitle: person.title, items: [] };
  }
  const fromTitle = isCommitmentNoteTitle(note.title)
    ? []
    : extractPromises(`${note.title}. ${note.body}`);
  const items = fromTitle.map((item, index) =>
    toProposed(person, item, "note", index, note.body, note.path),
  );
  return { source: "note", slug: person.slug, personTitle: person.title, items };
}

/** Propose from notes already Accepted on this one card. Never the full graph. */
export function proposeCommitmentsFromAcceptedNotes(person: PersonView): CommitmentProposal {
  const existing = new Set(
    person.notes.filter((note) => isCommitmentNoteTitle(note.title)).map((note) => whatFromCommitmentTitle(note.title).toLowerCase()),
  );
  const items: ProposedCommitment[] = [];
  const seen = new Set<string>();

  for (const note of person.notes) {
    if (SKIP_NOTE_TITLE.test(note.title) || isCommitmentNoteTitle(note.title)) continue;
    const proposal = proposeCommitmentsFromNote(person, note);
    for (const item of proposal.items) {
      const key = item.what.toLowerCase();
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  return { source: "note", slug: person.slug, personTitle: person.title, items };
}

export function setCommitmentChecked(
  proposal: CommitmentProposal,
  id: string,
  checked: boolean,
): CommitmentProposal {
  return {
    ...proposal,
    items: proposal.items.map((item) => (item.id === id ? { ...item, checked } : item)),
  };
}

export function setAllCommitmentsChecked(proposal: CommitmentProposal, checked: boolean): CommitmentProposal {
  return {
    ...proposal,
    items: proposal.items.map((item) => ({ ...item, checked })),
  };
}

/** Propose / dismiss / drop / open must never produce OKF write intents. */
export function proposeCommitmentWrites(): never[] {
  return [];
}

export function dismissCommitmentWrites(): never[] {
  return [];
}

export function dropCommitmentWrites(): never[] {
  return [];
}

export function commitmentsOpenWrites(): never[] {
  return [];
}

export function writesForAcceptedCommitments(
  proposal: CommitmentProposal,
): Array<Extract<OkfWriteIntent, { type: "note" }>> {
  return proposal.items
    .filter((item) => item.checked && item.what.trim())
    .map((item) => ({
      type: "note" as const,
      slug: item.slug,
      title: commitmentTitle(item.what),
      body: commitmentNoteBody({ what: item.what, dueDate: item.dueDate }),
    }));
}

export function writesForDoneCommitment(
  row: CommitmentRow,
): Extract<OkfWriteIntent, { type: "note" }> | null {
  const what = row.what.trim();
  if (!what) return null;
  return {
    type: "note",
    slug: row.slug,
    title: doneTitle(what),
    body: doneNoteBody(what),
  };
}

export function rememberDroppedCommitment(dropped: readonly string[], id: string): string[] {
  if (!id || dropped.includes(id)) return [...dropped];
  return [...dropped, id];
}

export function buildCommitmentPrompt(personTitle: string, sourceText: string): string {
  return [
    "You help a local-only personal CRM called Skuffen.",
    "Extract promises the user already made to this one person.",
    "Use only the note or capture below. Do not ask for or assume the rest of the people-graph.",
    "Do not include sibling cards. Do not send messages. Do not email or SMS.",
    "Do not upload or request the full graph.",
    'Return ONLY JSON: {"promises":[{"what":"","due":""}]}',
    `Name: ${personTitle}`,
    `Note or capture:\n${sourceText.trim()}`,
  ].join("\n");
}

export function assertCommitmentsNeverSend(sends: unknown[]): void {
  if (sends.length > 0) {
    throw new Error("commitments must not auto-send messages");
  }
}

export function assertNoGraphUpload(payload: string): void {
  if (GRAPH_UPLOAD.test(payload)) {
    throw new Error("commitments must not upload the people-graph");
  }
}

export function assertOnePersonOnly(payload: string, sibling: string): void {
  if (sibling && payload.includes(sibling)) {
    throw new Error("commitments must not include sibling people or the full graph");
  }
}

export function assertLocalCommitmentsNeedNoNetwork(rows: CommitmentRow[]): void {
  const payload = JSON.stringify(rows);
  if (LIVE_AI.test(payload)) {
    throw new Error("local commitments must not mention live provider hosts");
  }
}

export function assertNoMailIngest(payload: string): void {
  if (/gmail|imap|smtp|mail ingest|inboxes\.google/i.test(payload)) {
    throw new Error("commitments must not ingest mail");
  }
}

export function assertCommitmentsNeverSendCopy(payload: string): void {
  if (SEND_LEAK.test(payload)) {
    throw new Error("commitments must not send email or SMS");
  }
}

function toProposed(
  person: PersonView,
  item: { what: string; dueDate?: string },
  source: CommitmentProposalSource,
  index: number,
  sourceText: string,
  sourcePath?: string,
): ProposedCommitment {
  return {
    id: `commitment-${person.slug}-${source}-${index}`,
    checked: true,
    slug: person.slug,
    personTitle: person.title,
    what: item.what,
    dueDate: item.dueDate,
    sourcePath,
    sourceText,
  };
}

function cleanWhat(raw: string, dueDate?: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/\b(?:by|due:?|on)\s+\d{4}-\d{2}-\d{2}\b/gi, "");
  text = text.replace(/\bsynthetic\b.*$/i, "");
  text = text.replace(/\bnot a real (?:contact|person)\b.*$/i, "");
  text = text.replace(/[.,;:]+$/g, "").trim();
  if (dueDate) text = text.replace(dueDate, "").trim();
  if (text.length > 160) text = `${text.slice(0, 159).trim()}…`;
  return text;
}

function byDueThenWhat(a: CommitmentRow, b: CommitmentRow): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  const who = a.personTitle.localeCompare(b.personTitle);
  if (who) return who;
  return a.what.localeCompare(b.what) || a.id.localeCompare(b.id);
}
