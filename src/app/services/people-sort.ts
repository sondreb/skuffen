/**
 * People-list order. Local list order only — never a score, heat, or rank.
 * Desktop source of truth is OS-backed settings.json — never OKF, never tokens.
 */

export const PEOPLE_SORT_METHODS = ["name-az", "name-za", "updated", "added", "opened"] as const;

export type PeopleSortMethod = (typeof PEOPLE_SORT_METHODS)[number];

export const DEFAULT_PEOPLE_SORT: PeopleSortMethod = "name-az";

export const PEOPLE_SORT_LABELS: Record<PeopleSortMethod, string> = {
  "name-az": "Name A–Z",
  "name-za": "Name Z–A",
  updated: "Recently updated",
  added: "Recently added",
  opened: "Recently opened",
};

export function isPeopleSortMethod(value: unknown): value is PeopleSortMethod {
  return typeof value === "string" && (PEOPLE_SORT_METHODS as readonly string[]).includes(value);
}

export function normalizePeopleSort(value: unknown): PeopleSortMethod {
  if (typeof value !== "string") return DEFAULT_PEOPLE_SORT;
  const next = value.trim().toLowerCase();
  return isPeopleSortMethod(next) ? next : DEFAULT_PEOPLE_SORT;
}

export function peopleSortFromSettings(settings: { peopleSort?: string | null }): PeopleSortMethod {
  return normalizePeopleSort(settings.peopleSort);
}

export function lastOpenedFromSettings(settings: {
  peopleLastOpened?: Record<string, string> | null;
}): Record<string, string> {
  const raw = settings.peopleLastOpened;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [slug, at] of Object.entries(raw)) {
    if (!slug.trim() || typeof at !== "string") continue;
    if (!Number.isFinite(Date.parse(at))) continue;
    out[slug] = at;
  }
  return out;
}

export function stampOpened(
  opened: Record<string, string>,
  slug: string,
  at: string = new Date().toISOString(),
): Record<string, string> {
  const key = slug.trim();
  if (!key || !Number.isFinite(Date.parse(at))) return { ...opened };
  return { ...opened, [key]: at };
}

export function forgetOpened(opened: Record<string, string>, slug: string): Record<string, string> {
  if (!(slug in opened)) return { ...opened };
  const next = { ...opened };
  delete next[slug];
  return next;
}

export function retargetOpened(
  opened: Record<string, string>,
  fromSlug: string,
  toSlug: string,
): Record<string, string> {
  if (fromSlug === toSlug) return { ...opened };
  const from = opened[fromSlug];
  const next = forgetOpened(opened, fromSlug);
  if (!from) return next;
  const existing = next[toSlug];
  if (existing && stampMs(existing) >= stampMs(from)) return next;
  return { ...next, [toSlug]: from };
}

export function stampMs(value: string | undefined | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export function latestStamp(...values: Array<string | undefined | null>): string | undefined {
  let best: string | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const ms = stampMs(value);
    if (ms > bestMs) {
      best = value.trim();
      bestMs = ms;
    }
  }
  return best;
}

export type SortablePerson = {
  slug: string;
  title: string;
  addedAt?: string;
  updatedAt?: string;
};

export function comparePeopleByName(a: SortablePerson, b: SortablePerson): number {
  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return byTitle !== 0 ? byTitle : a.slug.localeCompare(b.slug);
}

/** Local list order. Recency uses timestamps only — never closeness or importance. */
export function sortPeople<T extends SortablePerson>(
  people: T[],
  method: PeopleSortMethod,
  lastOpened: Record<string, string> = {},
): T[] {
  const copy = [...people];
  copy.sort((left, right) => {
    if (method === "name-az") return comparePeopleByName(left, right);
    if (method === "name-za") return comparePeopleByName(right, left);
    const leftMs =
      method === "added"
        ? stampMs(left.addedAt)
        : method === "updated"
          ? stampMs(left.updatedAt)
          : stampMs(lastOpened[left.slug]);
    const rightMs =
      method === "added"
        ? stampMs(right.addedAt)
        : method === "updated"
          ? stampMs(right.updatedAt)
          : stampMs(lastOpened[right.slug]);
    if (leftMs !== rightMs) return rightMs - leftMs;
    return comparePeopleByName(left, right);
  });
  return copy;
}
