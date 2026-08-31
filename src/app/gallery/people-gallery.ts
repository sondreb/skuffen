/**
 * Menu → People gallery: local thumbs, name / #tag filter, no ranking.
 * #tag uses the people-tag store (`person.tags` / parsePeopleFilter) — never a second store.
 */
import { personListPhotoUrl } from "../list-photo";
import type { PersonView } from "../models";
import { parsePeopleFilter, personHasAllTags } from "../services/tags";

export type PeopleGalleryMode = "large" | "dense";

export const PEOPLE_GALLERY_MODES: readonly PeopleGalleryMode[] = ["large", "dense"];

export type GalleryPerson = {
  slug: string;
  title: string;
  givenName?: string;
  familyName?: string;
  /** From person.md tags — the #115 store. Not a second list. */
  tags?: readonly string[] | null;
};

export type ParsedGalleryFilter = {
  name: string;
  tags: string[];
};

export type GallerySlugDiff = {
  staying: string[];
  entering: string[];
  leaving: string[];
};

export function isPeopleGalleryMode(value: string): value is PeopleGalleryMode {
  return (PEOPLE_GALLERY_MODES as readonly string[]).includes(value);
}

/** Name leftover + #tag tokens from the shared people-tag parser. */
export function parseGalleryFilter(query: string): ParsedGalleryFilter {
  const parsed = parsePeopleFilter(query);
  return { name: parsed.text.toLowerCase(), tags: parsed.tags };
}

export function personMatchesGalleryFilter(person: GalleryPerson, query: string): boolean {
  const { name, tags } = parseGalleryFilter(query);
  if (!personHasAllTags({ tags: [...(person.tags ?? [])] }, tags)) return false;
  if (!name) return true;
  const hay = [person.title, person.givenName ?? "", person.familyName ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(name);
}

export function filterPeopleForGallery<T extends GalleryPerson>(
  people: readonly T[],
  query: string,
): T[] {
  if (!query.trim()) return [...people];
  return people.filter((person) => personMatchesGalleryFilter(person, query));
}

/** Profile image first, then first gallery photo. Never http(s). */
export function galleryPhotoUrl(
  person: Pick<PersonView, "image" | "imageSrc" | "photos">,
): string | null {
  const fromProfile = personListPhotoUrl(person.imageSrc ?? person.image);
  if (fromProfile) return fromProfile;
  const photo = person.photos[0];
  return personListPhotoUrl(photo?.listSrc ?? photo?.resource);
}

export function galleryInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function diffGallerySlugs(
  previous: readonly string[],
  next: readonly string[],
): GallerySlugDiff {
  const nextSet = new Set(next);
  const prevSet = new Set(previous);
  return {
    staying: previous.filter((slug) => nextSet.has(slug)),
    leaving: previous.filter((slug) => !nextSet.has(slug)),
    entering: next.filter((slug) => !prevSet.has(slug)),
  };
}
