import { hasVisibleProvenance, isAgentActor, type OkfProvenanceView } from "../../../packages/okf/src/index";
import type { FactProvenanceView } from "../models";

export function actorDisplayName(by: string): string {
  const trimmed = by.trim();
  if (trimmed === "human:user" || trimmed.startsWith("human:")) return "You";
  if (trimmed.startsWith("grok/")) return "Grok";
  if (trimmed.startsWith("gemini/")) return "Gemini";
  const slash = trimmed.indexOf("/");
  if (slash > 0) return trimmed.slice(0, slash);
  return trimmed;
}

export function stampDay(at?: string): string | undefined {
  if (!at) return undefined;
  const day = at.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

export function formatProvenanceLine(value: FactProvenanceView | OkfProvenanceView): string {
  const bits: string[] = [];
  if (value.generated?.by) bits.push(actorDisplayName(value.generated.by));
  const verified = value.verified[value.verified.length - 1];
  if (verified) {
    const day = stampDay(verified.at);
    bits.push(day ? `verified ${day}` : "verified");
  }
  const source = value.sources[0];
  if (source) bits.push(source.title || hostFromResource(source.resource) || source.resource);
  if (value.staleAfter) {
    const day = stampDay(value.staleAfter) ?? value.staleAfter;
    bits.push(`stale after ${day}`);
  }
  return bits.join(" · ");
}

export function visibleProvenanceLine(value?: FactProvenanceView | OkfProvenanceView | null): string {
  if (!value || !hasVisibleProvenance(value)) return "";
  return formatProvenanceLine(value);
}

export function suggestionSourceLabel(
  suggestion: { sources?: Array<{ resource: string; title?: string }>; url?: string },
): string {
  const source = suggestion.sources?.[0];
  if (source) return source.title || hostFromResource(source.resource) || source.resource;
  if (suggestion.url) return hostFromResource(suggestion.url) || suggestion.url;
  return "";
}

function hostFromResource(resource: string): string {
  try {
    const host = new URL(resource).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "";
  }
}

export { hasVisibleProvenance, isAgentActor };
