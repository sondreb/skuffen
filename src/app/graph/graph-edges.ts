import type { PersonView } from "../models";

/** Kinds this view draws when they exist on a local edge. Never scored. */
export const GRAPH_KIND_ORDER = ["family", "business", "other", "knows", "introduced-by"] as const;

export type GraphEdgeKind = (typeof GRAPH_KIND_ORDER)[number];

const GRAPH_KIND_LABEL: Record<string, string> = {
  family: "Family",
  business: "Business",
  other: "Other",
  knows: "Knows",
  "introduced-by": "Introduced by",
};

export interface GraphPersonNode {
  slug: string;
  title: string;
  /** Local data/blob for the node face. Never http(s). */
  imageSrc?: string;
}

/** One undirected typed edge. No weight, no score, no rank. */
export interface GraphRelationEdge {
  id: string;
  kind: string;
  from: GraphPersonNode;
  to: GraphPersonNode;
}

export interface PeopleGraphModel {
  nodes: GraphPersonNode[];
  edges: GraphRelationEdge[];
}

/**
 * Who-knows-who projection of the local people-graph.
 * Every local person is a node. Typed relations are links.
 * Places are ignored — this is not the geographic map.
 * No scoring, no friend-heat, no ranking.
 */
export function peopleGraphModel(people: readonly PersonView[]): PeopleGraphModel {
  const bySlug = new Map<string, PersonView>();
  for (const person of people) {
    bySlug.set(person.slug, person);
  }
  const nodes = [...bySlug.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map(nodeOf);
  const seen = new Set<string>();
  const edges: GraphRelationEdge[] = [];
  for (const person of bySlug.values()) {
    for (const relation of person.relations) {
      const other = bySlug.get(relation.slug);
      if (!other || other.slug === person.slug) continue;
      const id = graphEdgeId(person.slug, other.slug, relation.kind);
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        kind: relation.kind,
        from: nodeOf(person),
        to: nodeOf(other),
      });
    }
  }
  edges.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges };
}

export function graphEdgeId(a: string, b: string, kind: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `${left}|${right}:${kind}`;
}

export function graphKindLabel(kind: string): string {
  if (GRAPH_KIND_LABEL[kind]) return GRAPH_KIND_LABEL[kind];
  const trimmed = kind.trim();
  if (!trimmed) return "Other";
  return trimmed.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function graphLegendKinds(edges: readonly GraphRelationEdge[]): string[] {
  const present = new Set(edges.map((edge) => edge.kind));
  const ordered = GRAPH_KIND_ORDER.filter((kind) => present.has(kind));
  const extra = [...present].filter((kind) => !GRAPH_KIND_ORDER.includes(kind as GraphEdgeKind)).sort();
  return [...ordered, ...extra];
}

/** Same-size circle layout. Slug order only — never degree, never closeness. */
export function layoutPeopleGraph(
  slugs: readonly string[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const nodes = [...new Set(slugs)].sort((a, b) => a.localeCompare(b));
  const positions = new Map<string, { x: number; y: number }>();
  const padX = Math.min(80, width * 0.12);
  const padY = Math.min(96, height * 0.16);
  const cx = width / 2;
  const cy = height / 2;
  const innerW = Math.max(width - padX * 2, 1);
  const innerH = Math.max(height - padY * 2, 1);
  if (nodes.length === 0) return positions;
  if (nodes.length === 1) {
    positions.set(nodes[0]!, { x: cx, y: cy });
    return positions;
  }
  if (nodes.length === 2) {
    const gap = Math.min(innerW, innerH) * 0.28;
    positions.set(nodes[0]!, { x: cx - gap, y: cy });
    positions.set(nodes[1]!, { x: cx + gap, y: cy });
    return positions;
  }
  const radius = Math.min(innerW, innerH) * 0.38;
  nodes.forEach((slug, index) => {
    const angle = (2 * Math.PI * index) / nodes.length - Math.PI / 2;
    positions.set(slug, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });
  return positions;
}

function nodeOf(person: PersonView): GraphPersonNode {
  return {
    slug: person.slug,
    title: person.title,
    imageSrc: person.imageSrc,
  };
}
