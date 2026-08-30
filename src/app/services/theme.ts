/**
 * Appearance preference. Auto follows the OS until Light or Dark is pinned.
 * Desktop source of truth is OS-backed settings.json — never OKF, never tokens.
 */

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const PREFERENCES = new Set<ThemePreference>(["auto", "light", "dark"]);

export function normalizeThemePreference(value: unknown): ThemePreference {
  if (typeof value !== "string") return "auto";
  const next = value.trim().toLowerCase();
  return PREFERENCES.has(next as ThemePreference) ? (next as ThemePreference) : "auto";
}

export function themeFromSettings(settings: { theme?: string | null }): ThemePreference {
  return normalizeThemePreference(settings.theme);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

export function systemPrefersDark(media: { matches: boolean } | null | undefined): boolean {
  return Boolean(media?.matches);
}

type ThemeRoot = {
  dataset: DOMStringMap | Record<string, string>;
  style: { colorScheme: string };
};

export function applyThemeToDocument(
  root: ThemeRoot,
  preference: ThemePreference,
  resolved: ResolvedTheme,
): void {
  root.dataset["theme"] = resolved;
  root.dataset["themePreference"] = preference;
  root.style.colorScheme = resolved;
}
