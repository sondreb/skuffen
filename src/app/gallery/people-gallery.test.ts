import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import {
  diffGallerySlugs,
  filterPeopleForGallery,
  galleryInitials,
  galleryPhotoUrl,
  isPeopleGalleryMode,
  parseGalleryFilter,
  personMatchesGalleryFilter,
} from "./people-gallery.ts";

function person(overrides: Partial<PersonView> & { tags?: string[] } = {}): PersonView & {
  tags?: string[];
} {
  const slug = overrides.slug ?? "ada-demo";
  return {
    id: `people/${slug}/person`,
    slug,
    path: `people/${slug}/person.md`,
    title: overrides.title ?? "Ada Demo",
    description: "Synthetic demo card — not a real person",
    body: "Notes stay on this machine.",
    notes: [],
    social: [],
    photos: [],
    documents: [],
    relations: [],
    places: [],
    tags: [],
    ...overrides,
  };
}

test("parseGalleryFilter splits name text from #tag tokens", () => {
  assert.deepEqual(parseGalleryFilter(""), { name: "", tags: [] });
  assert.deepEqual(parseGalleryFilter("Ada"), { name: "ada", tags: [] });
  assert.deepEqual(parseGalleryFilter("#family"), { name: "", tags: ["family"] });
  assert.deepEqual(parseGalleryFilter("# family"), { name: "", tags: ["family"] });
  assert.deepEqual(parseGalleryFilter("Ada #family"), { name: "ada", tags: ["family"] });
  assert.deepEqual(parseGalleryFilter("#family #work"), { name: "", tags: ["family", "work"] });
});

test("name filter matches title and given/family name", () => {
  const ada = person({ title: "Ada Demo", givenName: "Ada", familyName: "Demo" });
  const bea = person({ slug: "bea-demo", title: "Bea Demo", givenName: "Bea" });
  assert.deepEqual(
    filterPeopleForGallery([ada, bea], "Ada").map((item) => item.slug),
    ["ada-demo"],
  );
  assert.deepEqual(
    filterPeopleForGallery([ada, bea], "demo").map((item) => item.slug),
    ["ada-demo", "bea-demo"],
  );
  assert.equal(filterPeopleForGallery([ada, bea], "  ").length, 2);
});

test("#tag matches person.tags when that store exists — no invented tags", () => {
  const ada = person({ tags: ["Family", "studio"] });
  const bea = person({ slug: "bea-demo", title: "Bea Demo", tags: ["work"] });
  const cal = person({ slug: "cal-demo", title: "Cal Demo" });

  assert.equal(personMatchesGalleryFilter(ada, "#family"), true);
  assert.equal(personMatchesGalleryFilter(ada, "# Family"), true);
  assert.equal(personMatchesGalleryFilter(bea, "#family"), false);
  assert.equal(personMatchesGalleryFilter(cal, "#family"), false);

  assert.deepEqual(
    filterPeopleForGallery([ada, bea, cal], "#family").map((item) => item.slug),
    ["ada-demo"],
  );
  assert.deepEqual(
    filterPeopleForGallery([ada, bea, cal], "Ada #family").map((item) => item.slug),
    ["ada-demo"],
  );
  assert.deepEqual(
    filterPeopleForGallery([ada, bea, cal], "#family #studio").map((item) => item.slug),
    ["ada-demo"],
  );
  assert.deepEqual(filterPeopleForGallery([ada, bea, cal], "#family #work").map((item) => item.slug), []);
});

test("plain Family without # is a name match, not a second tag store", () => {
  const ada = person({ title: "Ada Demo", tags: ["family"] });
  const kin = person({ slug: "family-friend", title: "Family Friend" });
  assert.deepEqual(
    filterPeopleForGallery([ada, kin], "Family").map((item) => item.slug),
    ["family-friend"],
  );
  assert.deepEqual(
    filterPeopleForGallery([ada, kin], "#family").map((item) => item.slug),
    ["ada-demo"],
  );
});

test("gallery photos stay data/blob — never http(s)", () => {
  assert.equal(galleryPhotoUrl(person({ image: "https://cdn.example/ada.jpg" })), null);
  assert.equal(galleryPhotoUrl(person({ imageSrc: "https://cdn.example/ada.jpg" })), null);
  assert.equal(
    galleryPhotoUrl(
      person({
        photos: [
          {
            id: "p",
            path: "people/ada-demo/photos/x.md",
            title: "Park",
            resource: "https://cdn.example/park.jpg",
          },
        ],
      }),
    ),
    null,
  );
  const data = "data:image/png;base64,aa";
  assert.equal(galleryPhotoUrl(person({ imageSrc: data })), data);
  assert.equal(
    galleryPhotoUrl(
      person({
        photos: [{ id: "p", path: "people/ada-demo/photos/x.md", title: "Park", listSrc: data }],
      }),
    ),
    data,
  );
});

test("initials and layout mode helpers", () => {
  assert.equal(galleryInitials("Ada Demo"), "AD");
  assert.equal(galleryInitials("Bea"), "B");
  assert.equal(isPeopleGalleryMode("large"), true);
  assert.equal(isPeopleGalleryMode("dense"), true);
  assert.equal(isPeopleGalleryMode("heat"), false);
});

test("slug diff marks who stays, enters, and leaves", () => {
  assert.deepEqual(diffGallerySlugs(["ada-demo", "bea-demo"], ["ada-demo"]), {
    staying: ["ada-demo"],
    leaving: ["bea-demo"],
    entering: [],
  });
  assert.deepEqual(diffGallerySlugs(["ada-demo"], ["ada-demo", "bea-demo"]), {
    staying: ["ada-demo"],
    leaving: [],
    entering: ["bea-demo"],
  });
});
