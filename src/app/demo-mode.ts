import type { FactSuggestion } from "./models";

/** Public-park pin used by `?demo=1` geocode. Not a real contact address. */
export const DEMO_PARK_HIT = {
  label: "Golden Gate Park, San Francisco, California, United States (demo)",
  latitude: 37.7694,
  longitude: -122.4862,
} as const;

/** True when the web preview is opened with `?demo=1`. Never enables live provider calls. */
export function isDemoMode(): boolean {
  if (typeof globalThis.location === "undefined") return false;
  return new URLSearchParams(globalThis.location.search).get("demo") === "1";
}

/**
 * Synthetic Grok-shaped proposal so Research / Suggest / Follow can paint
 * the Accept gate without API keys. Not a real person. Nothing is written until Accept.
 */
export function demoResearchSuggestions(source: FactSuggestion["source"] = "research"): FactSuggestion[] {
  return [
    {
      id: `demo-${source}-ada-note`,
      source,
      kind: "note",
      title: "Public park mention (demo)",
      body: "Synthetic Grok proposal for Ada Demo. Not a real contact. Accept to save — nothing is written before this.",
    },
  ];
}
