import assert from "node:assert/strict";
import { test } from "node:test";
import { publicPersonView } from "./redact.ts";

test("MCP default view drops raw email and phone", () => {
  const view = publicPersonView({
    id: "people/ada/person",
    slug: "ada",
    title: "Ada",
    email: "ada@example.com",
    phone: "+47 123 45 678",
    notes: [{ title: "Call", body: "ada@example.com / +47 123 45 678" }],
  });
  assert.equal(view.email, undefined);
  assert.equal(view.phone, undefined);
  const notes = view.notes as Array<{ body: string }>;
  assert.match(notes[0].body, /\[redacted-email\]/);
  assert.match(notes[0].body, /\[redacted-phone\]/);
});
