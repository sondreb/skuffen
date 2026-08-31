import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import { assertNoAutoSend, assertNoAutoWrite, proposeOnly } from "./research.ts";
import {
  COMMITMENTS_EMPTY,
  COMMITMENT_SYSTEM,
  assertCommitmentsNeverSend,
  assertCommitmentsNeverSendCopy,
  assertLocalCommitmentsNeedNoNetwork,
  assertNoGraphUpload,
  assertNoMailIngest,
  assertOnePersonOnly,
  buildCommitmentList,
  buildCommitmentPrompt,
  commitmentNoteBody,
  commitmentTitle,
  commitmentsOpenWrites,
  dismissCommitmentWrites,
  doneTitle,
  dropCommitmentWrites,
  extractPromises,
  isLocalDueDate,
  proposeCommitmentWrites,
  proposeCommitmentsFromAcceptedNotes,
  proposeCommitmentsFromNote,
  proposeCommitmentsFromText,
  rememberDroppedCommitment,
  setAllCommitmentsChecked,
  setCommitmentChecked,
  writesForAcceptedCommitments,
  writesForDoneCommitment,
} from "./commitments.ts";

function person(overrides: Partial<PersonView> = {}): PersonView {
  return {
    id: "people/ada-demo/person",
    slug: "ada-demo",
    path: "people/ada-demo/person.md",
    title: "Ada Demo",
    description: "Synthetic demo card — not a real person",
    email: "ada.demo@example.invalid",
    body: "Notes stay on this machine.",
    notes: [],
    social: [],
    photos: [],
    documents: [],
    relations: [],
    ...overrides,
  };
}

function bea(overrides: Partial<PersonView> = {}): PersonView {
  return person({
    id: "people/bea-demo/person",
    slug: "bea-demo",
    path: "people/bea-demo/person.md",
    title: "Bea Demo",
    description: "Second synthetic card — commitments demo only",
    email: "bea.demo@example.invalid",
    ...overrides,
  });
}

const PROMISE_NOTE = {
  id: "n1",
  path: "people/ada-demo/notes/coffee-lmgh0g00.md",
  title: "Coffee at the park (demo)",
  body: "I promised to send the park slip by 2026-09-06. Synthetic — not a real contact.",
};

test("empty list copy is honest and opening writes nothing", () => {
  const rows = buildCommitmentList({ people: [person()] });
  assert.equal(rows.length, 0);
  assert.equal(COMMITMENTS_EMPTY, "No commitments yet.");
  const writes = commitmentsOpenWrites();
  assert.deepEqual(writes, []);
  assertNoAutoWrite(writes);
});

test("extractPromises reads a local promise and a local due date", () => {
  const found = extractPromises(PROMISE_NOTE.body);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.what, "send the park slip");
  assert.equal(found[0]?.dueDate, "2026-09-06");
  assert.equal(isLocalDueDate(found[0]?.dueDate ?? ""), true);
});

test("propose from a note or capture never writes; Accept of a checked promise is the only write", () => {
  const writes: unknown[] = [];
  const ada = person({ notes: [PROMISE_NOTE] });
  const fromNote = proposeCommitmentsFromNote(ada, PROMISE_NOTE);
  const fromCapture = proposeCommitmentsFromText(
    ada,
    "Told Ada Demo I'd return the land-plot copy.",
    "capture",
  );

  assert.deepEqual(proposeCommitmentWrites(), []);
  assert.deepEqual(dismissCommitmentWrites(), []);
  assert.deepEqual(proposeOnly([]), []);
  assertNoAutoWrite(writes);
  assert.equal(fromNote.items.length, 1);
  assert.equal(fromNote.items[0]?.checked, true);
  assert.equal(fromNote.items[0]?.what, "send the park slip");
  assert.equal(fromNote.items[0]?.dueDate, "2026-09-06");
  assert.equal(fromNote.items[0]?.slug, "ada-demo");
  assert.equal(fromCapture.items[0]?.what, "return the land-plot copy");

  const empty = writesForAcceptedCommitments({ ...fromNote, items: [] });
  assert.deepEqual(empty, []);

  const unchecked = writesForAcceptedCommitments(setAllCommitmentsChecked(fromNote, false));
  assert.deepEqual(unchecked, []);

  const accepted = writesForAcceptedCommitments(fromNote);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.type, "note");
  assert.equal(accepted[0]?.slug, "ada-demo");
  assert.equal(accepted[0]?.title, commitmentTitle("send the park slip"));
  assert.match(accepted[0]?.body ?? "", /Due: 2026-09-06 \(local\)/);
  assert.match(accepted[0]?.body ?? "", /Nothing was sent/);
});

test("dismiss writes nothing; drop writes nothing to OKF", () => {
  const writes: unknown[] = [];
  assert.deepEqual(dismissCommitmentWrites(), []);
  assert.deepEqual(dropCommitmentWrites(), []);
  assertNoAutoWrite(writes);
  const dropped = rememberDroppedCommitment([], "people/ada-demo/notes/commitment.md");
  assert.deepEqual(dropped, ["people/ada-demo/notes/commitment.md"]);
  assert.deepEqual(rememberDroppedCommitment(dropped, "people/ada-demo/notes/commitment.md"), dropped);
});

test("accepted Commitment notes appear as rows; file path stays identity", () => {
  const ada = person({
    notes: [
      PROMISE_NOTE,
      {
        id: "c1",
        path: "people/ada-demo/notes/commitment-send-the-park-slip-lmgh0zzz.md",
        title: commitmentTitle("send the park slip"),
        body: commitmentNoteBody({ what: "send the park slip", dueDate: "2026-09-06" }),
        at: "2026-08-30T12:00:00Z",
      },
    ],
  });
  const rows = buildCommitmentList({ people: [ada] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "people/ada-demo/notes/commitment-send-the-park-slip-lmgh0zzz.md");
  assert.equal(rows[0]?.id, rows[0]?.sourcePath);
  assert.equal(rows[0]?.personTitle, "Ada Demo");
  assert.equal(rows[0]?.what, "send the park slip");
  assert.equal(rows[0]?.dueDate, "2026-09-06");
  assert.equal(rows[0]?.status, "open");
  assert.equal(rows[0]?.slug, "ada-demo");
});

test("marking done is an explicit write; a Done note hides the open row", () => {
  const row = buildCommitmentList({
    people: [
      person({
        notes: [
          {
            id: "c1",
            path: "people/ada-demo/notes/commitment-send-the-park-slip-aaa.md",
            title: commitmentTitle("send the park slip"),
            body: commitmentNoteBody({ what: "send the park slip", dueDate: "2026-09-06" }),
          },
        ],
      }),
    ],
  })[0];
  assert.ok(row);
  const intent = writesForDoneCommitment(row);
  assert.ok(intent);
  assert.equal(intent.type, "note");
  assert.equal(intent.title, doneTitle("send the park slip"));
  assert.match(intent.body, /Marked done on this machine/);
  assert.match(intent.body, /Nothing was sent/);

  const after = buildCommitmentList({
    people: [
      person({
        notes: [
          {
            id: "c1",
            path: row.sourcePath,
            title: commitmentTitle("send the park slip"),
            body: commitmentNoteBody({ what: "send the park slip", dueDate: "2026-09-06" }),
          },
          {
            id: "d1",
            path: "people/ada-demo/notes/done-send-the-park-slip-bbb.md",
            title: doneTitle("send the park slip"),
            body: "Marked done on this machine. Nothing was sent.",
          },
        ],
      }),
    ],
  });
  assert.equal(after.length, 0);
  const withDone = buildCommitmentList({
    people: [
      person({
        notes: [
          {
            id: "c1",
            path: row.sourcePath,
            title: commitmentTitle("send the park slip"),
            body: commitmentNoteBody({ what: "send the park slip" }),
          },
          {
            id: "d1",
            path: "people/ada-demo/notes/done-send-the-park-slip-bbb.md",
            title: doneTitle("send the park slip"),
            body: "Marked done on this machine. Nothing was sent.",
          },
        ],
      }),
    ],
    includeDone: true,
  });
  assert.equal(withDone[0]?.status, "done");
});

test("dropped ids hide a row without an OKF write", () => {
  const path = "people/ada-demo/notes/commitment-send-the-park-slip-aaa.md";
  const ada = person({
    notes: [
      {
        id: "c1",
        path,
        title: commitmentTitle("send the park slip"),
        body: commitmentNoteBody({ what: "send the park slip" }),
      },
    ],
  });
  assert.equal(buildCommitmentList({ people: [ada] }).length, 1);
  assert.equal(buildCommitmentList({ people: [ada], droppedIds: [path] }).length, 0);
  assert.deepEqual(dropCommitmentWrites(), []);
});

test("propose from accepted notes stays on that card and skips reconnect drafts", () => {
  const ada = person({
    notes: [
      PROMISE_NOTE,
      {
        id: "reconnect",
        path: "people/ada-demo/notes/reconnect-draft.md",
        title: "Reconnect draft — Ada Demo",
        body: "Hi Ada Demo — I'll catch up soon. Bea Demo is not on this card.",
      },
    ],
  });
  const proposal = proposeCommitmentsFromAcceptedNotes(ada);
  assert.equal(proposal.items.length, 1);
  assert.equal(proposal.items[0]?.what, "send the park slip");
  assert.doesNotMatch(JSON.stringify(proposal.items), /catch up soon/);
});

test("check/uncheck is local only", () => {
  const ada = person({ notes: [PROMISE_NOTE] });
  const proposal = proposeCommitmentsFromNote(ada, PROMISE_NOTE);
  const off = setCommitmentChecked(proposal, proposal.items[0]!.id, false);
  assert.equal(off.items[0]?.checked, false);
  assert.equal(proposal.items[0]?.checked, true);
  assert.deepEqual(proposeCommitmentWrites(), []);
});

test("nothing is sent; no mail ingest; no graph upload; no second store", () => {
  const sends: unknown[] = [];
  const ada = person({ notes: [PROMISE_NOTE] });
  const proposal = proposeCommitmentsFromNote(ada, PROMISE_NOTE);
  const rows = buildCommitmentList({
    people: [
      person({
        notes: [
          {
            id: "c1",
            path: "people/ada-demo/notes/commitment-send-the-park-slip-aaa.md",
            title: commitmentTitle("send the park slip"),
            body: commitmentNoteBody({ what: "send the park slip", dueDate: "2026-09-06" }),
          },
        ],
      }),
    ],
  });
  const payload = [JSON.stringify(rows), JSON.stringify(proposal), COMMITMENT_SYSTEM].join("\n");

  assertCommitmentsNeverSend(sends);
  assertNoAutoSend(sends);
  assertLocalCommitmentsNeedNoNetwork(rows);
  assertNoGraphUpload(payload);
  assertNoMailIngest(payload);
  assertCommitmentsNeverSendCopy(payload);
  assert.doesNotMatch(payload, /localStorage|grok_api_key|access_token|release\.yml/);
  assert.doesNotMatch(payload, /Bea Demo|bea-demo|Bob Example/);
  assertOnePersonOnly(payload, "Bea Demo");
});

test("prompt includes only that person — never the full graph or tokens", () => {
  const prompt = buildCommitmentPrompt("Ada Demo", PROMISE_NOTE.body);
  assert.match(prompt, /Ada Demo/);
  assert.match(prompt, /this one person/);
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /Do not email or SMS/);
  assert.match(prompt, /Do not include sibling cards/);
  assert.doesNotMatch(prompt, /Bea Demo|bea-demo|Bob Example/);
  assert.doesNotMatch(prompt, /full people-graph/);
  assert.doesNotMatch(prompt, /grok_api_key|access_token|localStorage/);
  assert.equal(prompt.includes(COMMITMENT_SYSTEM), false);
  assertOnePersonOnly(prompt, "Bea Demo");
  assertOnePersonOnly(prompt, "bea-demo");
  assertNoGraphUpload(prompt);
  assert.equal(COMMITMENT_SYSTEM.includes("Never send messages"), true);
  assert.equal(COMMITMENT_SYSTEM.includes("Never email or SMS"), true);
});

test("demo Ada can hold two synthetic commitments from local files", () => {
  const ada = person({
    notes: [
      {
        id: "c1",
        path: "people/ada-demo/notes/commitment-send-the-park-slip-aaa.md",
        title: commitmentTitle("send the park slip"),
        body: commitmentNoteBody({ what: "send the park slip", dueDate: "2026-09-06" }),
      },
      {
        id: "c2",
        path: "people/ada-demo/notes/commitment-return-the-land-plot-copy-bbb.md",
        title: commitmentTitle("return the land-plot copy"),
        body: commitmentNoteBody({ what: "return the land-plot copy" }),
      },
    ],
  });
  const other = bea({
    notes: [
      {
        id: "c3",
        path: "people/bea-demo/notes/commitment-studio-ccc.md",
        title: commitmentTitle("bring the studio key"),
        body: commitmentNoteBody({ what: "bring the studio key" }),
      },
    ],
  });
  const adaOnly = buildCommitmentList({ people: [ada] });
  assert.equal(adaOnly.length, 2);
  assert.ok(adaOnly.every((row) => row.slug === "ada-demo"));
  assert.ok(adaOnly.every((row) => row.id.startsWith("people/ada-demo/")));
  const across = buildCommitmentList({ people: [ada, other] });
  assert.equal(across.length, 3);
  assert.equal(across.filter((row) => row.slug === "ada-demo").length, 2);
});

test("Latch extra care: one card in a prompt, Accept-only write, no send, identifier stays me.grok.skuffen", () => {
  const writes: unknown[] = [];
  const sends: unknown[] = [];
  const ada = person({ notes: [PROMISE_NOTE] });
  const proposal = proposeCommitmentsFromNote(ada, PROMISE_NOTE);
  const prompt = buildCommitmentPrompt(ada.title, PROMISE_NOTE.body);
  const payload = [JSON.stringify(proposal), prompt, COMMITMENT_SYSTEM].join("\n");

  assert.deepEqual(proposeCommitmentWrites(), []);
  assert.deepEqual(dismissCommitmentWrites(), []);
  assert.deepEqual(dropCommitmentWrites(), []);
  assert.deepEqual(commitmentsOpenWrites(), []);
  assertNoAutoWrite(writes);
  assertCommitmentsNeverSend(sends);
  assertOnePersonOnly(payload, "Bea Demo");
  assertOnePersonOnly(payload, "bea-demo");
  assertNoGraphUpload(payload);
  assertNoMailIngest(payload);
  assertCommitmentsNeverSendCopy(payload);
  assert.doesNotMatch(payload, /release\.yml|OKF token|localStorage token/);
  assert.match(prompt, /Ada Demo/);

  const intent = writesForAcceptedCommitments(proposal);
  assert.equal(intent[0]?.type, "note");
  assert.equal(intent[0]?.slug, "ada-demo");
  assert.equal(intent[0]?.title.startsWith("Commitment — "), true);
});
