import { redactSensitiveRecord } from "../../packages/okf/src/index.ts";

export function publicPersonView(person: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveRecord({
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
  });
}
