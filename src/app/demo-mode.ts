import type { FactSuggestion } from "./models";

/** True when the web preview is opened with `?demo=1`. Never enables live provider calls. */
export function isDemoMode(): boolean {
  if (typeof globalThis.location === "undefined") return false;
  return new URLSearchParams(globalThis.location.search).get("demo") === "1";
}

/**
 * Synthetic Grok-shaped proposal so the Accept gate is visible without API keys.
 * Not a real person. Nothing is written until Accept.
 */
export function demoResearchSuggestions(): FactSuggestion[] {
  return [
    {
      id: "demo-research-ada-note",
      source: "research",
      kind: "note",
      title: "Public park mention (demo)",
      body: "Synthetic Grok proposal for Ada Demo. Not a real contact. Accept to save — nothing is written before this.",
    },
  ];
}
