# Labeled E2E demo recordings

Training clips are recorded against the **Angular web preview** (`npm start` / `ng serve` on port 1420), not the Tauri desktop shell. The browser stand-in keeps the people-graph in `localStorage` (plaintext). Tokens still never land in durable browser storage. Use `npm run tauri dev` when you need OS keychain encryption.

No ElevenLabs. No API keys. Demo people are synthetic (`Ada Demo` + a public-park geocode stub). Do not copy real people-graph files into this tree.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run test:e2e` | Headless Chromium smoke. No video. Safe for PR CI. |
| `npm run demo:record` | Writes WebM under `artifacts/demos/`. Headed when a display is available; otherwise headless (ffmpeg-friendly). |

`artifacts/` is gitignored. CI must not upload videos.

## Viewport and labels

Recordings use **1280×720**. A Playwright helper injects a high-contrast overlay (`data-demo-label`) with step copy such as:

- `1. Open drawer`
- `2. New person`
- `Accept to save — nothing is written before this`

Labels stay readable at that size (28px, brass border, dark plate).

## Demo query flag

Open `http://127.0.0.1:1420/?demo=1`. That flag only:

- Adds `data-demo` hooks on a few buttons for stable locators
- Stubs **Research with Grok** so the proposal panel and **Accept** path are visible without keys

It does not seed a people-graph, call `api.x.ai`, or write owner contacts.

Geocode and (in CI) map tiles are stubbed in the Playwright helper so the smoke is deterministic. `demo:record` still loads public OSM tiles for a real-looking map; Nominatim stays stubbed so the park pin is always the same synthetic result.

## Specs

1. `e2e/specs/01-hero-drawer.spec.ts` — what Skuffen is; empty drawer; Latch (local-only).
2. `e2e/specs/02-add-person-pin.spec.ts` — create **Ada Demo**, search a public park, save a pin.
3. `e2e/specs/03-research-accept.spec.ts` — stubbed Grok proposal, then Accept (the only write).

## CI

PR CI runs `E2E_DIST=1 npm run test:e2e` after `npm run build`, serving `dist/skuffen/browser` with Python's http.server. That avoids a second `ng serve` compile. Video is off. Missing ElevenLabs cannot fail this job — it is not used.

## Optional MP4

Playwright writes WebM. Convert locally if you need MP4:

```bash
ffmpeg -i artifacts/demos/what-is-skuffen-open-the-people-drawer.webm artifacts/demos/what-is-skuffen-open-the-people-drawer.mp4
```

Linux without a display: `demo:record` stays headless. To watch it, set `DISPLAY` and run headed, or `xvfb-run -a npm run demo:record`.
