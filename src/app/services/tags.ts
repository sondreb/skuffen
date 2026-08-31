import { normalizeTag, normalizeTagList } from "../../../packages/okf/src/index";
import type { FactSuggestion, PersonView } from "../models";

export type TagWrite = {
  slug: string;
  tag: string;
};

export type TagProposal = {
  id: string;
  checked: boolean;
  suggestion: FactSuggestion;
};

export type PeopleFilterQuery = {
  tags: string[];
  text: string;
};

export { normalizeTag, normalizeTagList };

const TAG_TOKEN = /#\s*([^\s#]+)/g;

/** `#family` or `# family` tokens. Leftover text is the name filter. */
export function parsePeopleFilter(query: string): PeopleFilterQuery {
  const tags: string[] = [];
  const text = query
    .replace(TAG_TOKEN, (_all, raw: string) => {
      const tag = normalizeTag(raw);
      if (tag) tags.push(tag);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { tags: normalizeTagList(tags), text };
}

export function personHasTag(person: Pick<PersonView, "tags">, tag: string): boolean {
  const key = normalizeTag(tag).toLowerCase();
  if (!key) return false;
  return (person.tags ?? []).some((item) => normalizeTag(item).toLowerCase() === key);
}

export function personHasAllTags(person: Pick<PersonView, "tags">, tags: string[]): boolean {
  return tags.every((tag) => personHasTag(person, tag));
}

export function existingTags(people: Array<Pick<PersonView, "tags">>): string[] {
  return normalizeTagList(people.flatMap((person) => person.tags ?? []));
}

export function suggestTags(known: string[], draft: string, already: string[]): string[] {
  const q = normalizeTag(draft).toLowerCase();
  if (!q) return [];
  const have = new Set(normalizeTagList(already).map((tag) => tag.toLowerCase()));
  return normalizeTagList(known).filter((tag) => {
    const key = tag.toLowerCase();
    return !have.has(key) && key.startsWith(q);
  });
}

export function proposeTag(input: {
  slug: string;
  tag: string;
  source?: FactSuggestion["source"];
}): TagProposal {
  const tag = normalizeTag(input.tag);
  const id = `tag-${input.slug}-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "tag"}`;
  return {
    id,
    checked: true,
    suggestion: {
      id,
      source: input.source ?? "ask",
      kind: "tag",
      title: tag,
      tag,
    },
  };
}

export function setTagChecked(proposal: TagProposal, checked: boolean): TagProposal {
  return { ...proposal, checked };
}

export function planAcceptedTag(slug: string, proposal: TagProposal): TagWrite | null {
  if (!proposal.checked) return null;
  return writesForAcceptedTag(slug, proposal.suggestion);
}

export function writesForAcceptedTag(slug: string, suggestion: FactSuggestion): TagWrite | null {
  if (suggestion.kind !== "tag") return null;
  const tag = normalizeTag(suggestion.tag || suggestion.title);
  if (!slug.trim() || !tag) return null;
  return { slug, tag };
}

/** Uncheck / Reject / Dismiss never produce an OKF write. */
export function tagWritesWithoutAccept(_proposal?: TagProposal | null): TagWrite[] {
  return [];
}

export function dismissTagProposal(): null {
  return null;
}

/** Same family tag from Suggest facts vs Research — one row, one Accept. */
export function demoTagSuggestion(source: FactSuggestion["source"] = "research"): FactSuggestion {
  return {
    id: "demo-tag-family",
    source,
    kind: "tag",
    title: "family (demo)",
    tag: "family",
  };
}

export function tagOfferKey(item: FactSuggestion): string | null {
  if (item.kind !== "tag") return null;
  const tag = normalizeTag(item.tag || item.title).toLowerCase();
  return tag || null;
}

export function filterPeopleByTags<T extends Pick<PersonView, "tags">>(people: T[], tags: string[]): T[] {
  if (!tags.length) return people;
  return people.filter((person) => personHasAllTags(person, tags));
}
