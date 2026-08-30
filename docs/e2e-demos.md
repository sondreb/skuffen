# Labeled E2E demo recordings

Training clips are recorded against the **Angular web preview** (`npm start` / `ng serve` on port 1420), not the Tauri desktop shell. The browser stand-in keeps the people-graph in `localStorage` (plaintext). Tokens still never land in durable browser storage. Use `npm run tauri dev` when you need OS keychain encryption.

No ElevenLabs. No API keys. Demo people are synthetic (`Ada Demo` + a public-park geocode stub). Do not copy real people-graph files into this tree. Grok (`api.x.ai`) and Gemini (`generativelanguage.google.com` / `generativelanguage.googleapis.com`) are mocked — the suite fails if the app attempts those hosts.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run test:e2e` | Headless Chromium smoke. No video. Safe for PR CI. |
| `npm run demo:record` | Writes WebM under `artifacts/demos/`, then curates 1280×720 PNG/MP4 into `docs/media/`. |

`artifacts/` is gitignored. Commit only the curated `docs/media/` stills and MP4s. CI must not upload videos.

## Viewport and labels

Recordings use **1280×720**. A Playwright helper injects a high-contrast overlay (`data-demo-label`) with step copy such as:

- `1. Open drawer`
- `2. New person`
- `Accept to save — nothing is written before this`

Labels stay readable at that size (28px, brass border, dark plate).

## Demo query flag

Open `http://127.0.0.1:1420/?demo=1`. That flag only:

- Adds `data-demo` hooks on a few buttons for stable locators
- Stubs **Research**, **Suggest facts**, **Follow**, **Capture**, and **Reconnect Shuffle** draft polish so the **Accept** path is visible without keys
- Stubs address search to a synthetic Golden Gate Park hit (no Nominatim)

It does not seed a people-graph, call `api.x.ai`, call Gemini, or write owner contacts.

Geocode is stubbed in `?demo=1` (and again in Playwright) so the park pin is always the same synthetic result. Map tiles are stubbed in CI so the smoke does not wait on OSM. `demo:record` still loads public OSM tiles for a real-looking map.

## Specs

1. `e2e/specs/01-hero-drawer.spec.ts` — what Skuffen is; empty drawer; Latch (local-only). Still: `screenshot-drawer.png`.
2. `e2e/specs/02-add-person-pin.spec.ts` — create **Ada Demo**, search a public park, save a pin. Still: `screenshot-person.png`.
3. `e2e/specs/03-research-accept.spec.ts` — stubbed Grok proposal, then Accept (the only write). Still: `screenshot-research.png`.
4. `e2e/specs/04-suggest-follow-mocked.spec.ts` — Suggest and Follow paint the same synthetic Ada Demo proposal. Not a README clip.
5. `e2e/specs/04-merge-proposal.spec.ts` — two synthetic cards with the same email; proposal appears; Accept merges; dismiss leaves both. No silent merge.
6. `e2e/specs/04-agent-memory.spec.ts` — Latch → Memory lists pending facts; dismiss drops; Accept writes.
7. `e2e/specs/06-pre-meeting-brief.spec.ts` — local brief from notes/place/pending; dismiss writes nothing; Accept saves a note. No live AI.
8. `e2e/specs/07-voice-capture.spec.ts` — paste/demo capture proposes people, dates, follow-ups; dismiss writes nothing; Accept writes. Live AI hosts blocked.
9. `e2e/specs/09-reconnect-shuffle.spec.ts` — two local suggestions from notes; pick drafts; skip/dismiss write nothing; Accept saves a note; nothing is sent. Live AI hosts blocked.

Curated clips:

- `docs/media/01-what-is-skuffen.mp4`
- `docs/media/02-add-person-and-place.mp4`
- `docs/media/03-grok-research-you-accept.mp4`

## CI

PR CI runs `E2E_DIST=1 npm run test:e2e` after `npm run build`, serving `dist/skuffen/browser` with Python's http.server. That avoids a second `ng serve` compile. Video is off. Missing ElevenLabs cannot fail this job — it is not used.

## Optional MP4

Playwright writes WebM under `artifacts/demos/`. `demo:record` converts the three README clips with ffmpeg:

```bash
ffmpeg -i artifacts/demos/what-is-skuffen-open-the-people-drawer.webm docs/media/01-what-is-skuffen.mp4
```

`demo:record` is headless so it works without a display. To watch the browser, run `DEMO_HEADED=1 npm run demo:record` (needs `DISPLAY` or `xvfb-run -a`).
