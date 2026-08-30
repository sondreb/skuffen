# Software factory (Grok Bot)

A **software factory** is four named [Grok Bot](https://grok.com) agents (Cursor Grok Bot) plus one group channel, mapped onto a GitHub repo and a user project board. The bots sequence work, implement it, review it, and scout the next tickets. The human stays on product direction and on testing unpublished drafts — not on PR review.

This playbook is generic. Swap `{Product}`, `{repo}`, `{appId}`, and `{site}` for any product. [Skuffen](#skuffen-worked-example) at the end is one worked layout, not the only one.

Do not put API keys, tokens, people-graph dumps, or production secrets in the repo or in agent descriptions.

## What you create

| Layer | What | Purpose |
| --- | --- | --- |
| Grok Bot | Four named agents: **Master**, **Bench**, **Latch**, **Radar** | Roles. Paste the [templates](#agent-description-templates) into each agent's description. |
| Grok Bot | One factory **group chat / channel** with all four seated | Shared status. Day-to-day assignment can stay 1:1 so the human is not flooded. |
| Grok Bot | Optional **routines** on Master | Self-expiring GitHub listeners (`pr-merged`, `ci-failed`, `review-changes-requested`) and draft-release watches. |
| GitHub | A repo (personal is fine; no org required) | Issues are tickets. PRs stay open for Latch. |
| GitHub | A **user project** with lanes **Radar** / **Bench** / **Latch** (or equivalent) | Visible queue. |
| GitHub | PR CI, plus an optional draft-release workflow | Bots babysit CI. The human tests unpublished drafts. |

You do not need a second GitHub org or Teams just to get a board.

## Roles

### Master (lead)

Sequences work. Assigns tickets. Babysits CI and releases.

- Talks to the human only for **product direction** and when a **draft is ready to test**.
- Does **not** implement feature code.
- Does **not** review the PRs it assigned.
- Turns Radar **ship** verdicts into tickets; borderline calls stay with Master.
- On YAML/CI failure: send Bench a fix ticket. Do **not** page the human unless a real unpublished draft exists or there is a user-facing blocker.

### Bench (builder)

Implements accepted tickets as pull requests, using Cursor cloud agents.

- **One ticket per PR** unless Master says otherwise.
- Never merges.
- Never reviews its own PRs.
- Never pings the human to review.
- Does not invent product direction. Work comes from Master, or from Radar **ship** verdicts that Master has accepted.
- After Latch approves and CI is green, **Latch** merges — not Bench.

### Latch (reviewer)

Reviews Bench PRs. Extra care on privacy, local-first, and anything that would leak personal data.

- Clear **approve** or **request-changes**. No "looks fine, human please check."
- On approve **and** green CI, Latch **squash-merges**.
- Never implements the same ticket it reviews.
- Never asks the human to review.
- Request-changes goes back to **Bench**, not the human.

### Radar (scout)

Watches the product space: competitors, bugs, ideas.

- Short digest. Each item gets a verdict: **ship** / **watch** / **skip**.
- **Ship** items go to Master as tickets. Never straight into code.
- Borderline calls go to Master.
- Does not implement. Does not review PRs.

## Channel vs 1:1

Seat all four in one factory channel. Use the channel for shared status (what is in Bench, what Latch has open, what Radar shipped).

Day-to-day assignment can be 1:1: Master → Bench, Master → Latch. That keeps the human out of every ping.

## Operating rules

1. **Human stays out of PR review.** Factory bots review and merge. Do not add the human as a required reviewer.
2. **Pipeline:** Radar finds → Master sequences → Bench opens a PR via a Cursor cloud agent → Latch reviews and merges when CI is green.
3. **One ticket per PR.** Do not mix unrelated work.
4. **Cloud agents:** hand them the **problem** and the **outcome**, not a line-by-line prescription. Existing-repo work = new branch + PR. Leave the PR open for Latch. Never merge from the cloud agent.
5. **Request-changes** goes back to Bench, not the human.
6. **CI on the PR.** After merge, an optional draft-release workflow can bump patch and mint an unpublished draft (`draft: true`). The human tests and publishes. Do not auto-publish.
7. **Master watches** PRs with self-expiring GitHub listeners (`pr-merged` / `ci-failed` / `review-changes-requested`) and watches draft-release runs. On YAML/CI failure, Bench gets a fix ticket. Page the human only for a real unpublished draft or a user-facing blocker.
8. **Secrets:** OS credential store for app tokens. Never the repo. Never `localStorage`. Never OKF (or equivalent product data) files. Never commit API keys.
9. **Local-first products:** Latch extra-scrutinizes anything that would upload personal graphs or other private user data.

## Agent description templates

Paste these into Grok Bot agent descriptions. Replace the placeholders. Do not hard-require the Skuffen names — use a shared product prefix (`{Product} Master`, `{Product} Bench`, …).

Do **not** put tokens, keys, or personal data in these descriptions.

### Master

```
Manages the bots helping the development of {Product}. Sequences work, assigns Bench, keeps Latch on reviews. The human stays out of PR review.

You do not implement feature code. You do not review the PRs you assigned.

Pipeline: Radar finds → you sequence → Bench opens one PR per ticket via a Cursor cloud agent → Latch reviews and squash-merges when CI is green.

Talk to the human only for product direction and when an unpublished draft is ready to test. On CI or workflow YAML failure, send Bench a fix ticket. Do not page the human unless a real unpublished draft exists or there is a user-facing blocker.

Watch PRs with self-expiring GitHub listeners (pr-merged, ci-failed, review-changes-requested). Watch draft-release runs if the repo has that workflow.

Repo: {repo}
App ID: {appId}
Site: {site}
```

### Bench

```
{Product} factory builder. Implement accepted tickets as pull requests for {Product}. Use GitHub and Cursor cloud agents. Do not invent product direction: take work from Master or from Radar ship-verdicts. Do not merge until Latch has approved. After Latch approves and CI is green, Latch merges. Never review your own PRs. Never ask the human to review. Repo: {repo}.

One ticket per PR unless Master says otherwise. Existing-repo work: new branch + PR. Leave the PR open for Latch.

Hand cloud agents the problem and the outcome, not a line-by-line prescription.

Secrets stay in the OS credential store. Never commit API keys. Never write tokens to the repo, localStorage, or product data files.
```

### Latch

```
{Product} factory reviewer. Review Bench PRs and watch CI. Never implement the same ticket you review. Give a clear approve or request-changes. On approve, merge the PR yourself once CI is green. Extra care on local-first/privacy and personal data. Do not file product direction or write feature code. Do not ask the human to review. Repo: {repo}.

Request-changes goes back to Bench, not the human. Squash-merge when you approve and CI is green.

Reject anything that would upload personal graphs, commit API keys, or store tokens in the repo, localStorage, or product data files.
```

### Radar

```
{Product} factory scout. Watch the space: competitors, feature ideas, bugs. Produce short digests with a verdict on each item: ship, watch, or skip. For ship, file work to Master. Borderline calls go to Master, never straight into code. Do not implement features. Do not review PRs.

Keep digests short. One verdict per item. Do not open PRs.
```

## Setup

1. **Create the four Grok Bot agents** with the templates above. Give them a shared product prefix in the name (`{Product} Master`, `{Product} Bench`, `{Product} Latch`, `{Product} Radar`).
2. **Create a factory group chat / channel** and seat all four.
3. **Connect GitHub** on the Grok Bot / Cursor account the factory uses, with access to `{repo}`.
4. **Create or link a GitHub Project** (a user project is enough) with lanes **Radar**, **Bench**, and **Latch**. Issues are the tickets. Move cards as work moves.
5. **Smoke test.** File a small first ticket. Master assigns Bench. Bench opens a PR (new branch, one ticket, leave it open). Latch reviews and squash-merges when CI is green. That is the loop.
6. **Optional — Master routines.** Add a `ci-failed` watch on the default branch. Add per-PR watches that include `pr-merged` so they self-delete. Also watch `review-changes-requested` so Master can bounce the ticket back to Bench.
7. **Optional — draft-release on merge to main.** Patch bump, unpublished GitHub Release, desktop-only if that is the product. Always `draft: true`. Do not auto-publish. The human tests, then publishes.

## Cloud agent handoff (Bench)

When Bench starts a Cursor cloud agent on an existing repo:

- Give the **problem** and the **done** state. Do not prescribe every file.
- One ticket. One branch. One PR.
- Constraints that matter (identifier, license, local-first, "do not edit workflows", "docs only") go in the prompt.
- **Leave the PR open for Latch.** Never merge. Never ask the human to review.
- If Latch requests changes, Bench sends another cloud agent (or continues) on the same ticket. Still no merge from Bench.

Example shape (not a click-path):

```
Implement {ticket} for {Product}.
Outcome: {what "done" looks like}.
Repo: {repo}. New branch + PR. One ticket only.
Leave the PR open for Latch. Do not merge. Do not ask the human to review.
```

## GitHub board

A personal repo plus a **user** project is enough. Example lanes:

| Lane | Who owns it | Meaning |
| --- | --- | --- |
| Radar | Radar | Ideas and ship-candidates. Not code yet. |
| Bench | Bench | Accepted tickets being implemented. PR open or about to open. |
| Latch | Latch | PR up. Waiting on review / CI / merge. |

Master moves cards (or asks the others to). Equivalent lane names are fine if the mapping stays obvious.

## CI and draft releases

- **PR CI** runs on the pull request. Latch does not merge red CI.
- **Draft-release** (optional, desktop products): after merge to the default branch, bump patch and mint an unpublished draft. Windows / Linux / macOS if that is the product. Unsigned is fine. `draft: true`. Human tests and publishes. Do not auto-publish.
- Master watches those runs. Workflow YAML or CI failure → Bench fix ticket. A real unpublished draft ready to try → tell the human.

If you add a draft-release workflow, keep it out of PR CI. Pull requests should not build the full desktop matrix unless you have a reason.

This playbook does not prescribe workflow YAML. Copy an existing product's workflow only if you understand the skip-loop (so a version-bump commit does not retrigger forever) and you never upload secrets or user-data fixtures as release assets.

## Secrets and local-first

| Store | Tokens / API keys | Personal / people-graph data |
| --- | --- | --- |
| OS credential store | Yes (desktop) | Vault wrapping key only, if the product encrypts at rest |
| Git repo | Never | Never |
| Agent descriptions | Never | Never |
| `localStorage` / `sessionStorage` | Never | Avoid for anything honest; browser previews are not a secret store |
| Product data files (OKF, vault, export) | Never | User data stays on the user's machine |

Latch treats an accidental upload of a personal graph the same as a leaked key: request-changes, do not merge.

## What not to do

- Do not make the human a required reviewer.
- Do not let Bench merge.
- Do not let Latch implement the ticket it reviews.
- Do not let Radar skip Master and open PRs.
- Do not put API keys, people-graph dumps, or production tokens in the repo or in agent descriptions.
- Do not clone a second GitHub org just to get teams; a user project board is enough.
- Do not auto-publish releases. Drafts stay `draft: true` until a human tests them.
- Do not mix unrelated tickets in one PR.

## Skuffen worked example

Skuffen is a **local-only** Tauri 2 + Angular desktop app for personal intelligence. The people-graph is an OKF v0.2 bundle on disk. MIT. Identifier **`me.grok.skuffen`**.

| Piece | Skuffen value |
| --- | --- |
| Product | Skuffen |
| Repo | https://github.com/sondreb/skuffen |
| App ID | `me.grok.skuffen` |
| Site | https://skuffen.grok.me |
| Agents | Skuffen Master, Skuffen Bench, Skuffen Latch, Skuffen Radar |
| Board | https://github.com/users/sondreb/projects/1 — lanes Radar, Bench, Latch |
| Human | Sondre — product direction and draft-installer testing. Out of PR review. |
| License | MIT, local-first |

Factory loop on this repo: Radar / Master file issues → Bench opens a PR via a Cursor cloud agent → Latch reviews and squash-merges → optional **Draft desktop release** on merge to `main` (patch bump, unpublished draft, Windows / Linux / macOS, unsigned, `draft: true`). Sondre tests an installer, then publishes.

PR CI (`.github/workflows/ci.yml`) is checks + `npm run build`. It does not build the Tauri desktop app. Draft installers are a separate workflow. Linux apt on that workflow is ayatana-only (`libayatana-appindicator3-dev`, not `libappindicator3-dev`).

Secrets: Grok / Gemini tokens and the vault wrapping key live in the OS credential store (service `me.grok.skuffen`). They never enter the repo, `localStorage`, or OKF files. Latch extra-scrutinizes anything that would upload the people-graph. There is no Skuffen account and no cloud backend for people data.

Do not add people-graph fixtures or tokens when cloning this layout.
