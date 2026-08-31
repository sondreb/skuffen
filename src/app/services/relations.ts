import {
  inverseRelationRole,
  isRelationKind,
  normalizeRelationRole,
  presetRolesForKind,
  type RelationKind,
} from "../../../packages/okf/src/index";
import type { FactSuggestion, PersonView } from "../models";
import { placeOfferKey } from "./places";
import { parsePeopleFilter, personHasAllTags, tagOfferKey } from "./tags";

export type RelationWrite = {
  slug: string;
  relatedSlug: string;
  kind: RelationKind;
  role: string;
};

export type RelationProposal = {
  id: string;
  checked: boolean;
  suggestion: FactSuggestion;
};

export const RELATION_KINDS: RelationKind[] = ["family", "business", "other"];

export const RELATION_KIND_LABEL: Record<RelationKind, string> = {
  family: "Family",
  business: "Business",
  other: "Other",
};

export function relationRoleOptions(kind: RelationKind): string[] {
  return [...presetRolesForKind(kind)];
}

export function relationRoleLabel(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return "";
  return trimmed[0]!.toUpperCase() + trimmed.slice(1);
}

export function relationKindLabel(kind: RelationKind): string {
  return RELATION_KIND_LABEL[kind];
}

export function peopleMatchingRelationKind(people: PersonView[], kind: RelationKind | ""): PersonView[] {
  if (!kind) return people;
  return people.filter((person) => person.relations.some((edge) => edge.kind === kind));
}

export function filterPeopleByRelation(
  people: PersonView[],
  query: string,
  kind: RelationKind | "",
): PersonView[] {
  const parsed = parsePeopleFilter(query);
  const q = parsed.text.toLowerCase();
  const byKind = peopleMatchingRelationKind(people, kind);
  return byKind.filter((person) => {
    if (!personHasAllTags(person, parsed.tags)) return false;
    if (!q) return true;
    const roles = person.relations.map((edge) => `${edge.kind} ${edge.role} ${edge.title}`).join(" ");
    return `${person.title} ${person.description ?? ""} ${roles}`.toLowerCase().includes(q);
  });
}

export function proposeRelation(input: {
  slug: string;
  relatedSlug: string;
  relatedTitle: string;
  kind: RelationKind;
  role: string;
  source?: FactSuggestion["source"];
}): RelationProposal {
  const kind = isRelationKind(input.kind) ? input.kind : "other";
  const role = normalizeRelationRole(kind, input.role) || "custom";
  const id = `relation-${input.slug}-${input.relatedSlug}-${kind}-${role}`;
  return {
    id,
    checked: true,
    suggestion: {
      id,
      source: input.source ?? "ask",
      kind: "relation",
      title: `${relationRoleLabel(role)} of ${input.relatedTitle}`,
      relationKind: kind,
      relationRole: role,
      relatedSlug: input.relatedSlug,
    },
  };
}

export function setRelationChecked(proposal: RelationProposal, checked: boolean): RelationProposal {
  return { ...proposal, checked };
}

export function planAcceptedRelation(slug: string, proposal: RelationProposal): RelationWrite | null {
  if (!proposal.checked) return null;
  return writesForAcceptedRelation(slug, proposal.suggestion);
}

export function writesForAcceptedRelation(slug: string, suggestion: FactSuggestion): RelationWrite | null {
  if (suggestion.kind !== "relation") return null;
  const relatedSlug = suggestion.relatedSlug?.trim();
  const kind = suggestion.relationKind;
  const role = suggestion.relationRole?.trim();
  if (!slug.trim() || !relatedSlug || relatedSlug === slug || !isRelationKind(kind) || !role) return null;
  return {
    slug,
    relatedSlug,
    kind,
    role: normalizeRelationRole(kind, role),
  };
}

/** Uncheck / Reject / Dismiss never produce an OKF write. */
export function relationWritesWithoutAccept(_proposal?: RelationProposal | null): RelationWrite[] {
  return [];
}

export function dismissRelationProposal(): null {
  return null;
}

export function inverseWrite(write: RelationWrite): RelationWrite {
  return {
    slug: write.relatedSlug,
    relatedSlug: write.slug,
    kind: write.kind,
    role: inverseRelationRole(write.role),
  };
}

export function demoRelationSuggestion(
  source: FactSuggestion["source"],
  other: { slug: string; title: string },
): FactSuggestion {
  return {
    id: `demo-relation-${other.slug}`,
    source,
    kind: "relation",
    title: `Sibling of ${other.title} (demo)`,
    relationKind: "family",
    relationRole: "sibling",
    relatedSlug: other.slug,
  };
}

/** Same edge from Suggest facts vs Research — one row, one dismiss. */
export function relationOfferKey(item: FactSuggestion): string | null {
  if (item.kind !== "relation") return null;
  const slug = item.relatedSlug?.trim();
  const kind = item.relationKind;
  const role = item.relationRole?.trim();
  if (!slug || !kind || !role) return null;
  return `${slug}\0${kind}\0${role}`;
}

export function collapseEquivalentSuggestions(items: FactSuggestion[]): FactSuggestion[] {
  const seenIds = new Set<string>();
  const seenRelations = new Set<string>();
  const seenPlaces = new Set<string>();
  const seenTags = new Set<string>();
  const out: FactSuggestion[] = [];
  for (const item of items) {
    if (seenIds.has(item.id)) continue;
    const key = relationOfferKey(item);
    const placeKey = placeOfferKey(item);
    const tagKey = tagOfferKey(item);
    if (key && seenRelations.has(key)) continue;
    if (placeKey && seenPlaces.has(placeKey)) continue;
    if (tagKey && seenTags.has(tagKey)) continue;
    seenIds.add(item.id);
    if (key) seenRelations.add(key);
    if (placeKey) seenPlaces.add(placeKey);
    if (tagKey) seenTags.add(tagKey);
    out.push(item);
  }
  return out;
}

export function equivalentSuggestionIds(items: FactSuggestion[], target: FactSuggestion): string[] {
  const key = relationOfferKey(target);
  const placeKey = placeOfferKey(target);
  const tagKey = tagOfferKey(target);
  return [
    ...new Set(
      items
        .filter(
          (item) =>
            item.id === target.id ||
            (key !== null && relationOfferKey(item) === key) ||
            (placeKey !== null && placeOfferKey(item) === placeKey) ||
            (tagKey !== null && tagOfferKey(item) === tagKey),
        )
        .map((item) => item.id),
    ),
  ];
}

export function relationCue(person: PersonView): string {
  if (person.relations.length === 0) return "";
  const first = person.relations[0]!;
  if (person.relations.length === 1) {
    return `${relationRoleLabel(first.role)} · ${first.title}`;
  }
  return `${person.relations.length} relations`;
}

export function otherPeopleForRelation(people: PersonView[], slug: string): PersonView[] {
  return people.filter((item) => item.slug !== slug);
}

/** Card rows show the other person's title, not their slug. */
export function resolveRelationTitles(people: PersonView[]): PersonView[] {
  const titles = new Map(people.map((person) => [person.slug, person.title]));
  return people.map((person) => ({
    ...person,
    relations: person.relations.map((edge) => ({
      ...edge,
      title: titles.get(edge.slug) ?? edge.title,
    })),
  }));
}
