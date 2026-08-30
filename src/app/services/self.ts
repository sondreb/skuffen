/**
 * Local app-owner mark. One person slug, stored in settings — not a Skuffen account.
 * Desktop source of truth is OS-backed settings.json. Never tokens. Never OKF secrets.
 */

export function normalizeSelfSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  return slug ? slug : null;
}

/** Marking a second person replaces the first. One self only. */
export function markSelf(_current: string | null, slug: string): string | null {
  return normalizeSelfSlug(slug);
}

export function unmarkSelf(): null {
  return null;
}

export function isSelf(selfSlug: string | null | undefined, slug: string): boolean {
  const current = normalizeSelfSlug(selfSlug);
  return current !== null && current === slug;
}

export function retargetSelf(selfSlug: string | null | undefined, fromSlug: string, toSlug: string): string | null {
  const current = normalizeSelfSlug(selfSlug);
  if (!current || current !== fromSlug) return current;
  return normalizeSelfSlug(toSlug);
}

export function forgetSelf(selfSlug: string | null | undefined, slug: string): string | null {
  const current = normalizeSelfSlug(selfSlug);
  return current === slug ? null : current;
}

/** Later features (briefs, commitments) read this — no cloud identity. */
export function selfSlugFromSettings(settings: { selfSlug?: string | null }): string | null {
  return normalizeSelfSlug(settings.selfSlug);
}
