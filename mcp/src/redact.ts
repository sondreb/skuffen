import { redactSensitiveRecord } from "../../packages/okf/src/index.ts";

/** List/search omit relations and tags so MCP cannot dump the graph or everyone’s labels. */
export function publicPersonView(
  person: Record<string, unknown>,
  options?: { includeRelations?: boolean; includeTags?: boolean },
): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: person.id,
    slug: person.slug,
    title: person.title,
    description: person.description,
    givenName: person.givenName,
    familyName: person.familyName,
    notes: person.notes,
    social: person.social,
    photos: person.photos,
    location: person.location,
    documents: person.documents,
    places: person.places,
    generated: person.generated,
    verified: person.verified,
    sources: person.sources,
    status: person.status,
    stale_after: person.stale_after,
  };
  if (options?.includeRelations) view.relations = person.relations;
  if (options?.includeTags) view.tags = person.tags;
  return redactSensitiveRecord(view);
}
