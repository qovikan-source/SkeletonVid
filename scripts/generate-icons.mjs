import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.resolve(__dirname, "..", "extension", "icons");

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const full = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(full), 0);
  return Buffer.concat([lenBuf, full, crcBuf]);
}

function generatePng(size) {
  const width = size;
  const height = size;
  const rowLen = width * 4;
  const rawRows = Buffer.alloc(height * (rowLen + 1));

  // Background #0F172A, Accent #10B981, Border #334155
  const bg = [0x0f, 0x17, 0x2a, 0xff];
  const border = [0x33, 0x41, 0x55, 0xff];
  const emerald = [0x10, 0xb9, 0x81, 0xff];

  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    rawRows[rawOffset++] = 0; // Filter: none
    for (let x = 0; x < width; x++) {
      const nx = x / (width - 1);
      const ny = y / (height - 1);

      // Rounded rectangle frame
      const margin = 0.08;
      const insideBox = nx >= margin && nx <= (1 - margin) && ny >= margin && ny <= (1 - margin);
      const isFrameBorder = insideBox && (
        nx <= margin + 0.08 || nx >= 1 - margin - 0.08 ||
        ny <= margin + 0.08 || ny >= 1 - margin - 0.08
      );

      // Play triangle in center: nx in [0.35, 0.7], ny in [0.3, 0.7]
      const insideTriangle = nx >= 0.38 && nx <= 0.68 &&
        ny >= 0.5 - (nx - 0.38) * 0.7 &&
        ny <= 0.5 + (nx - 0.38) * 0.7;

      let pixel = bg;
      if (insideTriangle) {
        pixel = emerald;
      } else if (isFrameBorder) {
        pixel = border;
      }

      rawRows[rawOffset++] = pixel[0];
      rawRows[rawOffset++] = pixel[1];
      rawRows[rawOffset++] = pixel[2];
      rawRows[rawOffset++] = pixel[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idatData = zlib.deflateSync(rawRows);

  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idatData),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

export function writeIcons() {
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const png = generatePng(size);
    const dest = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(dest, png);
    console.log(`[SkeletonVid] Generated ${dest} (${size}x${size})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeIcons();
}
