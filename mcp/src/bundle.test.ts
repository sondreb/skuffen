import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseIndex } from "../../packages/okf/src/index.ts";
import { OkfBundle } from "./bundle.ts";

test("MCP writes person, note, social and reloads from disk", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-"));
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const created = bundle.createPerson({ title: "Ada Lovelace", description: "Mathematician" });
  bundle.addNote(created.slug, "Analytical Engine", "First algorithm.");
  bundle.addSocial(created.slug, "wikipedia", "https://en.wikipedia.org/wiki/Ada_Lovelace", "Ada_Lovelace");

  const reloaded = new OkfBundle(root).getPerson(created.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.title, "Ada Lovelace");
  assert.equal(reloaded.notes[0].title, "Analytical Engine");
  assert.equal(reloaded.social[0].url, "https://en.wikipedia.org/wiki/Ada_Lovelace");
  assert.equal(parseIndex(readFileSync(join(root, "index.md"), "utf8")).okfVersion, "0.2");
});
