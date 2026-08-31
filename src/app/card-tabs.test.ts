import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CARD_SECTIONS,
  CARD_SECTION_LABELS,
  cardPanelId,
  cardTabId,
  isCardSection,
  nextCardSection,
} from "./card-tabs.ts";

test("card sections are the sections that already live on the person card", () => {
  assert.deepEqual([...CARD_SECTIONS], [
    "about",
    "photos",
    "files",
    "timeline",
    "commitments",
    "relations",
  ]);
  assert.equal(CARD_SECTION_LABELS.about, "About");
  assert.equal(isCardSection("photos"), true);
  assert.equal(isCardSection("map"), false);
});

test("arrow keys wrap; Home and End jump the strip", () => {
  assert.equal(nextCardSection("about", "ArrowRight"), "photos");
  assert.equal(nextCardSection("relations", "ArrowRight"), "about");
  assert.equal(nextCardSection("about", "ArrowLeft"), "relations");
  assert.equal(nextCardSection("photos", "ArrowLeft"), "about");
  assert.equal(nextCardSection("files", "Home"), "about");
  assert.equal(nextCardSection("about", "End"), "relations");
  assert.equal(nextCardSection("about", "Enter"), null);
  assert.equal(nextCardSection("about", " "), null);
});

test("tab and panel ids stay local and stable", () => {
  assert.equal(cardTabId("photos"), "card-tab-photos");
  assert.equal(cardPanelId("files"), "card-panel-files");
});
