import { deflateSync } from "node:zlib";
import { createAdaDemo, expect, openDemo, test } from "../helpers/app";

const BUNDLE_KEY = "skuffen.bundle.files";
const BLOBS_KEY = "skuffen.bundle.blobs";

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** Wide local photo so a left-edge pointer is clearly off-center. */
function solidPng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      raw[i] = 42;
      raw[i + 1] = 96;
      raw[i + 2] = 88;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PHOTO = solidPng(640, 360);

async function diskSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(
    ({ filesKey, blobsKey }) => ({
      files: localStorage.getItem(filesKey),
      blobs: localStorage.getItem(blobsKey),
    }),
    { filesKey: BUNDLE_KEY, blobsKey: BLOBS_KEY },
  );
}

function parseTransform(value: string): { x: number; y: number; scale: number } {
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(value);
  if (!match) throw new Error(`unexpected transform: ${value}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

test("wheel zoom in the overlay is toward the pointer, not the image center", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PHOTO,
  });
  await expect(page.locator("[data-profile-image] img")).toHaveAttribute("src", /^data:image\//);

  const before = await diskSnapshot(page);

  await page.locator("[data-profile-preview]").click();
  const photo = page.locator("[data-image-preview-photo]");
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute("src", /^data:image\//);
  await expect(photo).not.toHaveAttribute("src", /^https?:/);

  const box = await photo.boundingBox();
  if (!box) throw new Error("preview photo has no box");
  expect(box.width).toBeGreaterThan(200);

  const leftX = box.x + 24;
  const midY = box.y + box.height / 2;
  await page.locator("[data-image-preview-stage]").evaluate(
    (el, { clientX, clientY }) => {
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -160, clientX, clientY, bubbles: true, cancelable: true }),
      );
    },
    { clientX: leftX, clientY: midY },
  );

  const leftZoom = parseTransform(await photo.evaluate((el) => (el as HTMLElement).style.transform));
  expect(leftZoom.scale).toBeGreaterThan(1);
  expect(leftZoom.x).toBeGreaterThan(20);

  await page.locator("[data-preview-close]").click();
  await page.locator("[data-profile-preview]").click();
  await expect(photo).toBeVisible();

  const centerBox = await photo.boundingBox();
  if (!centerBox) throw new Error("preview photo has no box");
  await page.locator("[data-image-preview-stage]").evaluate(
    (el, { clientX, clientY }) => {
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -160, clientX, clientY, bubbles: true, cancelable: true }),
      );
    },
    { clientX: centerBox.x + centerBox.width / 2, clientY: centerBox.y + centerBox.height / 2 },
  );

  const centerZoom = parseTransform(
    await photo.evaluate((el) => (el as HTMLElement).style.transform),
  );
  expect(centerZoom.scale).toBeGreaterThan(1);
  expect(Math.abs(centerZoom.x)).toBeLessThan(2);
  expect(Math.abs(centerZoom.y)).toBeLessThan(2);

  const beforePan = centerZoom;
  await photo.hover();
  await page.mouse.down();
  await page.mouse.move(centerBox.x + centerBox.width / 2 + 48, centerBox.y + centerBox.height / 2 + 16);
  await page.mouse.up();
  const panned = parseTransform(await photo.evaluate((el) => (el as HTMLElement).style.transform));
  expect(panned.scale).toBe(beforePan.scale);
  expect(Math.abs(panned.x - beforePan.x)).toBeGreaterThan(10);

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);
  await expect(await diskSnapshot(page)).toEqual(before);
});
