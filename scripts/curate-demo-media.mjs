#!/usr/bin/env node
/**
 * Copy Playwright WebM recordings to curated README MP4s under docs/media/.
 * Screenshots are written there directly during `demo:record`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts", "demos");
const media = path.join(root, "docs", "media");

const videos = [
  ["what-is-skuffen-open-the-people-drawer.webm", "01-what-is-skuffen.mp4"],
  ["add-a-person-and-pin-a-place-on-the-map.webm", "02-add-person-and-place.mp4"],
  ["grok-research-proposes-user-accepts.webm", "03-grok-research-you-accept.mp4"],
];

const stills = ["screenshot-drawer.png", "screenshot-person.png", "screenshot-research.png"];

mkdirSync(media, { recursive: true });

for (const name of stills) {
  const dest = path.join(media, name);
  if (!existsSync(dest)) {
    throw new Error(`missing README still ${dest} — run demo:record first`);
  }
}

for (const [srcName, destName] of videos) {
  const src = path.join(artifacts, srcName);
  if (!existsSync(src)) {
    throw new Error(`missing recording ${src}`);
  }
  const dest = path.join(media, destName);
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      src,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      "-an",
      dest,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${srcName}`);
  }
}

console.log("curated README media under docs/media/");
