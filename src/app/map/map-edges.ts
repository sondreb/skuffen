import type { PersonView, RelationKind } from "../models";

export interface MapRelationEnd {
  slug: string;
  title: string;
  latitude: number;
  longitude: number;
}

/** One undirected local edge between two people who both have a place. */
export interface MapRelationEdge {
  id: string;
  kind: RelationKind;
  from: MapRelationEnd;
  to: MapRelationEnd;
}

/**
 * Overlay lines for the people map. Uses the typed people-graph edges already
 * on each card — no second relation model, no scoring, no ranking.
 */
export function mapRelationEdges(people: readonly PersonView[]): MapRelationEdge[] {
  const located = new Map<string, PersonView>();
  for (const person of people) {
    if (person.location) located.set(person.slug, person);
  }
  const seen = new Set<string>();
  const edges: MapRelationEdge[] = [];
  for (const person of located.values()) {
    for (const relation of person.relations) {
      const other = located.get(relation.slug);
      if (!other || other.slug === person.slug) continue;
      const id = edgeId(person.slug, other.slug, relation.kind);
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        kind: relation.kind,
        from: endOf(person),
        to: endOf(other),
      });
    }
  }
  return edges;
}

export function edgeId(a: string, b: string, kind: RelationKind): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `${left}|${right}:${kind}`;
}

function endOf(person: PersonView): MapRelationEnd {
  const location = person.location!;
  return {
    slug: person.slug,
    title: person.title,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}
