import { redactSensitiveRecord } from "../../packages/okf/src/index.ts";

/** List/search omit relations so MCP cannot dump the who-knows-who graph. */
export function publicPersonView(
  person: Record<string, unknown>,
  options?: { includeRelations?: boolean },
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
  };
  if (options?.includeRelations) view.relations = person.relations;
  return redactSensitiveRecord(view);
}
