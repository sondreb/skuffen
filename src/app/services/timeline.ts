import type { FactSuggestion, FollowRecord, PersonView } from "../models";
import { timestampFromNotePath } from "./shuffle";

export const TIMELINE_EMPTY = "No timeline yet.";

export type TimelineKind = "note" | "photo" | "document" | "place" | "follow";

export interface TimelineEvent {
  /** File path when the event is an OKF document. Follow uses `follow:<slug>`. */
  id: string;
  kind: TimelineKind;
  /** Short honest label. Not a ranker score. */
  label: string;
  at: string | null;
  dateLabel: string;
  /** Bundle-relative path. Identity for OKF rows. */
  path?: string;
}

export interface TimelineInput {
  person: PersonView;
  follow?: FollowRecord | null;
  /**
   * Pending research / suggest / follow proposals. Never appear on the tape.
   * Accept is the only OKF write for new facts.
   */
  pendingSuggestions?: FactSuggestion[];
}

/** Opening Timeline is a view. It never produces an OKF write. */
export function timelineOpenWrites(): never[] {
  return [];
}

/**
 * Chronological tape of what already exists locally for one person.
 * Newest first. Pending research is ignored. No second store.
 */
export function buildPersonTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const note of input.person.notes) {
    events.push(
      toEvent({
        kind: "note",
        id: note.path || note.id,
        path: note.path,
        label: note.title.trim() || "Note",
        at: resolveAt(note.at, note.path),
      }),
    );
  }

  for (const photo of input.person.photos) {
    events.push(
      toEvent({
        kind: "photo",
        id: photo.path || photo.id,
        path: photo.path,
        label: photo.title.trim() || "Photo",
        at: resolveAt(photo.at, photo.path),
      }),
    );
  }

  for (const doc of input.person.documents) {
    events.push(
      toEvent({
        kind: "document",
        id: doc.path || doc.id,
        path: doc.path,
        label: doc.title.trim() || "Document",
        at: resolveAt(doc.at, doc.path),
      }),
    );
  }

  const place = input.person.location;
  if (place) {
    const at = resolveAt(place.at);
    if (at) {
      events.push(
        toEvent({
          kind: "place",
          id: place.path,
          path: place.path,
          label: "Place pin",
          at,
        }),
      );
    }
  }

  const follow = input.follow;
  if (follow?.lastRunAt) {
    events.push(
      toEvent({
        kind: "follow",
        id: `follow:${follow.slug}`,
        label: "Follow",
        at: follow.lastRunAt,
      }),
    );
  }

  void input.pendingSuggestions;
  return events.sort(byNewestFirst);
}

export function assertTimelineIsViewOnly(writes: unknown[]): void {
  if (writes.length > 0) {
    throw new Error("opening Timeline must not write");
  }
}

export function assertNoPendingResearchOnTape(
  events: TimelineEvent[],
  pending: FactSuggestion[],
): void {
  const ids = new Set(events.map((item) => item.id));
  for (const item of pending) {
    if (ids.has(item.id)) {
      throw new Error("pending research must not appear on the timeline until Accept");
    }
  }
}

export function assertTimelineOneCardOnly(events: TimelineEvent[], slug: string): void {
  const prefix = `people/${slug}/`;
  const documents = "documents/";
  for (const event of events) {
    if (event.kind === "follow") {
      if (event.id !== `follow:${slug}`) {
        throw new Error("follow row must belong to this card");
      }
      continue;
    }
    const path = event.path ?? event.id;
    const onCard = path.startsWith(prefix) || path.startsWith(documents);
    if (!onCard) {
      throw new Error(`timeline row is not on this card: ${path}`);
    }
  }
}

function toEvent(input: {
  kind: TimelineKind;
  id: string;
  path?: string;
  label: string;
  at: string | null;
}): TimelineEvent {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    at: input.at,
    dateLabel: formatDateLabel(input.at),
    path: input.path,
  };
}

function resolveAt(at?: string, path?: string): string | null {
  if (at && at.trim()) return at.trim();
  if (path) {
    const ms = timestampFromNotePath(path);
    if (ms) return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return null;
}

function formatDateLabel(at: string | null): string {
  if (!at) return "undated";
  const day = at.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : at;
}

function byNewestFirst(a: TimelineEvent, b: TimelineEvent): number {
  const ta = a.at ? Date.parse(a.at) : Number.NaN;
  const tb = b.at ? Date.parse(b.at) : Number.NaN;
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (aOk && bOk && ta !== tb) return tb - ta;
  if (aOk && !bOk) return -1;
  if (!aOk && bOk) return 1;
  return (a.path ?? a.id).localeCompare(b.path ?? b.id);
}
