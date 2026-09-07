// Resize the approved artwork without redrawing it. Sharp is installed by Next.js.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const source = "public/brand/shelfscout-icon-v3.png";
await mkdir("public/icons", { recursive: true });
for (const size of [16, 32, 48, 64, 192, 512]) {
  await sharp(source).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
}
await sharp(source).resize(180, 180).png().toFile("app/apple-icon.png");
// Extra padding keeps the whole lens and handle inside the maskable safe circle.
await sharp(source).resize(416, 416)
  .extend({ top: 48, bottom: 48, left: 48, right: 48, background: "#245a49" })
  .png().toFile("public/icons/icon-maskable-512.png");

// ICO supports PNG frames; include native small sizes for browser tab rendering.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size => sharp(source).resize(size, size).ensureAlpha().png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile("app/favicon.ico", Buffer.concat([header, ...frames]));
