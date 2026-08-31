import type { PersonLocation, PersonView, PlaceView } from "../models";
import type { MapPin } from "./people-map.component";

/**
 * Map pins prefer first-class Places when they have coordinates.
 * People without a Place still appear from people/{slug}/place.md.
 */
export function mapPinsForGraph(input: {
  places: readonly PlaceView[];
  people: readonly PersonView[];
}): MapPin[] {
  const pins: MapPin[] = [];
  const covered = new Set<string>();

  for (const place of input.places) {
    const location = placeLocation(place);
    if (!location) continue;
    pins.push({
      slug: place.slug,
      title: place.title,
      location,
      kind: "place",
    });
    for (const person of input.people) {
      if ((person.places ?? []).some((link) => link.slug === place.slug && link.location)) {
        covered.add(person.slug);
      }
    }
  }

  for (const person of input.people) {
    if (covered.has(person.slug)) continue;
    if (!person.location) continue;
    pins.push({
      slug: person.slug,
      title: person.title,
      location: person.location,
      kind: "person",
    });
  }

  return pins;
}

export function personMapLocation(person: PersonView): PersonLocation | undefined {
  const linked = (person.places ?? []).find((link) => link.location);
  return linked?.location ?? person.location;
}

function placeLocation(place: PlaceView): PersonLocation | undefined {
  if (place.location) return place.location;
  if (
    typeof place.latitude === "number" &&
    typeof place.longitude === "number" &&
    Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude)
  ) {
    return {
      path: place.path,
      title: place.title,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      source: place.source,
    };
  }
  return undefined;
}
