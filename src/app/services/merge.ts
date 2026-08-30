import type {
  MergeFieldChoice,
  MergeOverlap,
  MergeProposal,
  PersonField,
  PersonLocation,
  PersonView,
} from "../models";

export type MergeCandidate = {
  keeper: PersonView;
  incoming: PersonView;
  overlaps: MergeOverlap[];
};

export type MergePlan = {
  keeperSlug: string;
  incomingSlug: string;
  fields: Partial<Record<PersonField, string>>;
  notes: Array<{ title: string; body: string }>;
  social: Array<{ network: string; url: string; handle?: string }>;
  photos: Array<{ path: string; resource?: string; title: string }>;
  place?: PersonLocation;
  documents: Array<{ slug: string }>;
};

const PERSON_FIELDS: PersonField[] = [
  "title",
  "description",
  "givenName",
  "familyName",
  "email",
  "phone",
  "body",
];

const FIELD_LABELS: Record<PersonField, string> = {
  title: "Name",
  description: "How you know them",
  givenName: "Given name",
  familyName: "Family name",
  email: "Email",
  phone: "Phone",
  body: "About",
};

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function normalizeEmail(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/\D+/g, "");
}

export function normalizeSocialUrl(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

export function normalizeHandle(network?: string | null, handle?: string | null): string {
  const net = (network ?? "").trim().toLowerCase();
  const name = (handle ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!net || !name) return "";
  return `${net}:${name}`;
}

export function defaultAboutBody(title: string): string {
  return `# About\n\nNotes and social links for ${title} live beside this document.`;
}

export function meaningfulBody(title: string, body?: string | null): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed || trimmed === defaultAboutBody(title).trim()) return "";
  return trimmed;
}

export function identityOverlaps(a: PersonView, b: PersonView): MergeOverlap[] {
  const overlaps: MergeOverlap[] = [];
  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  if (emailA && emailA === emailB) {
    overlaps.push({ kind: "email", value: emailA, label: `same email ${emailA}` });
  }

  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  if (phoneA && phoneA === phoneB) {
    overlaps.push({ kind: "phone", value: phoneA, label: `same phone ${a.phone ?? phoneA}` });
  }

  const urlsA = new Map<string, string>();
  const handlesA = new Map<string, string>();
  for (const item of a.social) {
    const url = normalizeSocialUrl(item.url);
    if (url) urlsA.set(url, item.url ?? url);
    const handle = normalizeHandle(item.network, item.handle);
    if (handle) handlesA.set(handle, `${item.network ?? ""} ${item.handle ?? ""}`.trim());
  }
  const seenSocial = new Set<string>();
  for (const item of b.social) {
    const url = normalizeSocialUrl(item.url);
    if (url && urlsA.has(url) && !seenSocial.has(`url:${url}`)) {
      seenSocial.add(`url:${url}`);
      overlaps.push({ kind: "social", value: url, label: `same social ${urlsA.get(url) ?? url}` });
    }
    const handle = normalizeHandle(item.network, item.handle);
    if (handle && handlesA.has(handle) && !seenSocial.has(`handle:${handle}`)) {
      seenSocial.add(`handle:${handle}`);
      overlaps.push({
        kind: "social",
        value: handle,
        label: `same social ${handlesA.get(handle) ?? handle}`,
      });
    }
  }
  return overlaps;
}

export function richness(person: PersonView): number {
  return (
    person.notes.length +
    person.social.length +
    person.photos.length +
    person.documents.length +
    (person.location ? 1 : 0) +
    (person.email ? 1 : 0) +
    (person.phone ? 1 : 0) +
    (person.description ? 1 : 0) +
    (meaningfulBody(person.title, person.body) ? 1 : 0)
  );
}

export function pickKeeper(a: PersonView, b: PersonView): [PersonView, PersonView] {
  const scoreA = richness(a);
  const scoreB = richness(b);
  if (scoreA > scoreB) return [a, b];
  if (scoreB > scoreA) return [b, a];
  return a.slug <= b.slug ? [a, b] : [b, a];
}

export function findDuplicateCandidates(
  people: PersonView[],
  dismissed: readonly string[] = [],
): MergeCandidate[] {
  const skipped = new Set(dismissed);
  const out: MergeCandidate[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const left = people[i];
      const right = people[j];
      const overlaps = identityOverlaps(left, right);
      if (overlaps.length === 0) continue;
      if (skipped.has(pairKey(left.slug, right.slug))) continue;
      const [keeper, incoming] = pickKeeper(left, right);
      out.push({ keeper, incoming, overlaps });
    }
  }
  return out;
}

function fieldValue(person: PersonView, field: PersonField): string {
  if (field === "body") return meaningfulBody(person.title, person.body);
  const value = person[field];
  return typeof value === "string" ? value.trim() : "";
}

export function proposeMerge(keeper: PersonView, incoming: PersonView, overlaps: MergeOverlap[]): MergeProposal {
  const fields: MergeFieldChoice[] = [];
  for (const field of PERSON_FIELDS) {
    const incomingValue = fieldValue(incoming, field);
    if (!incomingValue) continue;
    const keeperValue = fieldValue(keeper, field);
    if (keeperValue === incomingValue) continue;
    fields.push({
      id: `field-${field}`,
      keep: !keeperValue,
      kind: "field",
      field,
      label: FIELD_LABELS[field],
      value: incomingValue,
      sourceSlug: incoming.slug,
    });
  }
  for (const note of incoming.notes) {
    fields.push({
      id: `note-${note.id}`,
      keep: true,
      kind: "note",
      label: `Note: ${note.title}`,
      value: note.body,
      sourceSlug: incoming.slug,
      noteTitle: note.title,
      noteBody: note.body,
    });
  }
  const keeperUrls = new Set(keeper.social.map((item) => normalizeSocialUrl(item.url)).filter(Boolean));
  for (const item of incoming.social) {
    const url = normalizeSocialUrl(item.url);
    if (url && keeperUrls.has(url)) continue;
    fields.push({
      id: `social-${item.id}`,
      keep: true,
      kind: "social",
      label: `Thread: ${item.title}`,
      value: item.url || item.handle || item.network || item.title,
      sourceSlug: incoming.slug,
      network: item.network,
      url: item.url,
      handle: item.handle,
    });
  }
  for (const photo of incoming.photos) {
    fields.push({
      id: `photo-${photo.id}`,
      keep: true,
      kind: "photo",
      label: `Photo: ${photo.title}`,
      value: photo.resource || photo.path,
      sourceSlug: incoming.slug,
      photoPath: photo.path,
      photoResource: photo.resource,
      photoTitle: photo.title,
    });
  }
  if (incoming.location && !keeper.location) {
    const place = incoming.location;
    fields.push({
      id: `place-${place.path}`,
      keep: true,
      kind: "place",
      label: "Map pin",
      value: place.address || place.title,
      sourceSlug: incoming.slug,
      place,
    });
  }
  return {
    id: `merge-${pairKey(keeper.slug, incoming.slug)}`,
    keeperSlug: keeper.slug,
    incomingSlug: incoming.slug,
    keeperTitle: keeper.title,
    incomingTitle: incoming.title,
    overlaps,
    fields,
  };
}

export function setMergeFieldKept(proposal: MergeProposal, id: string, keep: boolean): MergeProposal {
  return {
    ...proposal,
    fields: proposal.fields.map((field) => (field.id === id ? { ...field, keep } : field)),
  };
}

export function setAllMergeFieldsKept(proposal: MergeProposal, keep: boolean): MergeProposal {
  return {
    ...proposal,
    fields: proposal.fields.map((field) => ({ ...field, keep })),
  };
}

export function deleteMergeField(proposal: MergeProposal, id: string): MergeProposal {
  return {
    ...proposal,
    fields: proposal.fields.filter((field) => field.id !== id),
  };
}

export function planAcceptedMerge(proposal: MergeProposal): MergePlan {
  const kept = proposal.fields.filter((field) => field.keep);
  const fields: Partial<Record<PersonField, string>> = {};
  const notes: MergePlan["notes"] = [];
  const social: MergePlan["social"] = [];
  const photos: MergePlan["photos"] = [];
  const documents: MergePlan["documents"] = [];
  let place: PersonLocation | undefined;
  for (const item of kept) {
    if (item.kind === "field" && item.field && item.value.trim()) {
      fields[item.field] = item.value.trim();
    } else if (item.kind === "note") {
      notes.push({ title: item.noteTitle || item.label, body: item.noteBody || item.value });
    } else if (item.kind === "social" && item.url) {
      social.push({ network: item.network || "web", url: item.url, handle: item.handle });
    } else if (item.kind === "photo") {
      photos.push({
        path: item.photoPath || "",
        resource: item.photoResource,
        title: item.photoTitle || item.label,
      });
    } else if (item.kind === "place" && item.place) {
      place = item.place;
    } else if (item.kind === "document" && item.documentSlug) {
      documents.push({ slug: item.documentSlug });
    }
  }
  return {
    keeperSlug: proposal.keeperSlug,
    incomingSlug: proposal.incomingSlug,
    fields,
    notes,
    social,
    photos,
    place,
    documents,
  };
}

export function dismissMergeProposal(): null {
  return null;
}

/** Detecting a collision never writes OKF. Accept is the only merge path. */
export function mergeWritesWithoutAccept(_proposal: MergeProposal | null): [] {
  return [];
}

export function assertNoAutoMerge(writes: unknown[]): void {
  if (writes.length > 0) {
    throw new Error("duplicate-person merge must not auto-write");
  }
}

export function rememberDismissedPair(dismissed: readonly string[], a: string, b: string): string[] {
  const key = pairKey(a, b);
  if (dismissed.includes(key)) return [...dismissed];
  return [...dismissed, key];
}
