import {
  isPlaceLinkRole,
  normalizePlaceLinkRole,
  type PlaceLinkRole,
} from "../../../packages/okf/src/index";
import type { FactSuggestion, PlaceView } from "../models";

export type PlaceWrite = {
  slug: string;
  placeName: string;
  notes?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  placeRole?: PlaceLinkRole;
  placeSlug?: string;
};

export type PlaceProposal = {
  id: string;
  checked: boolean;
  suggestion: FactSuggestion;
};

export const PLACE_LINK_ROLE_LABEL: Record<PlaceLinkRole, string> = {
  lives: "Lives",
  works: "Works",
  "met-at": "Met at",
};

export const PLACE_LINK_ROLES: PlaceLinkRole[] = ["lives", "works", "met-at"];

export function placeRoleLabel(role: string): string {
  if (isPlaceLinkRole(role)) return PLACE_LINK_ROLE_LABEL[role];
  const trimmed = role.trim();
  if (!trimmed) return "";
  return trimmed[0]!.toUpperCase() + trimmed.slice(1);
}

export function proposePlace(input: {
  slug: string;
  placeName: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  placeRole?: PlaceLinkRole;
  source?: FactSuggestion["source"];
}): PlaceProposal {
  const role = input.placeRole && isPlaceLinkRole(input.placeRole) ? input.placeRole : "met-at";
  const id = `place-${input.slug}-${input.placeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${role}`;
  return {
    id,
    checked: true,
    suggestion: {
      id,
      source: input.source ?? "ask",
      kind: "place",
      title: input.placeName,
      placeName: input.placeName,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      placeRole: role,
    },
  };
}

export function setPlaceChecked(proposal: PlaceProposal, checked: boolean): PlaceProposal {
  return { ...proposal, checked };
}

export function planAcceptedPlace(slug: string, proposal: PlaceProposal): PlaceWrite | null {
  if (!proposal.checked) return null;
  return writesForAcceptedPlace(slug, proposal.suggestion);
}

export function writesForAcceptedPlace(slug: string, suggestion: FactSuggestion): PlaceWrite | null {
  if (suggestion.kind !== "place") return null;
  const placeName = (suggestion.placeName || suggestion.title || "").trim();
  if (!slug.trim() || !placeName) return null;
  const role = suggestion.placeRole ? normalizePlaceLinkRole(suggestion.placeRole) : "met-at";
  return {
    slug,
    placeName,
    notes: suggestion.body,
    address: suggestion.address,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
    placeRole: role || "met-at",
    placeSlug: suggestion.placeSlug?.trim() || undefined,
  };
}

/** Uncheck / Reject / Dismiss never produce an OKF write. */
export function placeWritesWithoutAccept(_proposal?: PlaceProposal | null): PlaceWrite[] {
  return [];
}

export function dismissPlaceProposal(): null {
  return null;
}

/** Same park from Suggest facts vs Research — one row, one Accept. */
export function demoPlaceSuggestion(source: FactSuggestion["source"] = "research"): FactSuggestion {
  return {
    id: "demo-place-park",
    source,
    kind: "place",
    title: "Golden Gate Park (demo)",
    body: "Synthetic place proposal. Accept to save — nothing is written before this.",
    placeName: "Golden Gate Park",
    address: "Golden Gate Park, San Francisco, California, United States (demo)",
    latitude: 37.7694,
    longitude: -122.4862,
    placeRole: "met-at",
  };
}

export function placeOfferKey(item: FactSuggestion): string | null {
  if (item.kind !== "place") return null;
  const name = (item.placeName || item.title || "").trim().toLowerCase();
  if (!name) return null;
  return `${name}\0${item.placeRole ?? "met-at"}\0${item.latitude ?? ""}\0${item.longitude ?? ""}`;
}

export function emptyPlacesCopy(): { kicker: string; lede: string; whisper: string } {
  return {
    kicker: "On this machine",
    lede: "No places yet",
    whisper:
      "Places stay in the local OKF bundle on this machine. Skuffen does not fetch places from the network. There is no Skuffen backend.",
  };
}

export function resolvePlaceTitles(places: PlaceView[], peopleTitles: Map<string, string>): PlaceView[] {
  return places.map((place) => ({
    ...place,
    people: place.people.map((link) => ({
      ...link,
      title: peopleTitles.get(link.slug) ?? link.title,
    })),
  }));
}
