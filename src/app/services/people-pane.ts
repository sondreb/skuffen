/**
 * Left people pane: expanded names, or a photo strip.
 * Desktop source of truth is OS-backed settings.json — never OKF, never tokens.
 */

/** Below this width, an unset preference defaults to the photo strip. */
export const NARROW_PEOPLE_PANE_MAX = 1100;

export function collapsedFromSettings(settings: {
  peoplePaneCollapsed?: boolean | null;
}): boolean | null {
  return typeof settings.peoplePaneCollapsed === "boolean" ? settings.peoplePaneCollapsed : null;
}

export function defaultCollapsedForWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width < NARROW_PEOPLE_PANE_MAX;
}

export function resolvePeoplePaneCollapsed(stored: boolean | null, width: number): boolean {
  return stored ?? defaultCollapsedForWidth(width);
}
