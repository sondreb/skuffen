import assert from "node:assert/strict";
import { test } from "node:test";
import { actorAgent, actorHuman, defaultStaleAfter } from "../../../packages/okf/src/index.ts";
import {
  actorDisplayName,
  formatProvenanceLine,
  suggestionSourceLabel,
  visibleProvenanceLine,
} from "./provenance.ts";

test("provenance line is calm and names Grok vs You", () => {
  assert.equal(actorDisplayName(actorAgent("grok", "grok-4-latest")), "Grok");
  assert.equal(actorDisplayName(actorAgent("gemini", "gemini-2.5-flash")), "Gemini");
  assert.equal(actorDisplayName(actorHuman()), "You");
  const line = formatProvenanceLine({
    generated: { by: actorAgent("grok", "grok-4-latest"), at: "2026-09-08T06:00:00Z" },
    verified: [{ by: actorHuman(), at: "2026-09-08T06:01:00Z" }],
    sources: [{ resource: "https://example.invalid/ada-demo", title: "Public page (demo)" }],
    staleAfter: defaultStaleAfter("2026-09-08T06:00:00Z", 180),
  });
  assert.match(line, /Grok/);
  assert.match(line, /verified 2026-09-08/);
  assert.match(line, /Public page \(demo\)/);
  assert.match(line, /stale after 2027-03-07/);
  assert.doesNotMatch(line, /green|score|rank|trust dashboard/i);
});

test("human-only notes without sources stay quiet", () => {
  assert.equal(
    visibleProvenanceLine({
      generated: { by: actorHuman(), at: "2026-09-08T06:00:00Z" },
      verified: [{ by: actorHuman(), at: "2026-09-08T06:00:00Z" }],
      sources: [],
    }),
    "",
  );
});

test("suggestion source label prefers cited title", () => {
  assert.equal(
    suggestionSourceLabel({
      sources: [{ resource: "https://example.invalid/ada-demo", title: "Public page (demo)" }],
    }),
    "Public page (demo)",
  );
});
