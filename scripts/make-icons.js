// Genera public/icon-192.png e icon-512.png sin dependencias (PNG dibujado a mano):
// fondo oscuro con un prompt "›_" en naranja.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const BG = [0x11, 0x11, 0x11];
const FG = [0xff, 0x7a, 0x45];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// Distancia de un punto a un segmento.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function icon(size) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  const u = (v) => v * size;
  const w = u(0.07);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filtro PNG "None"
    for (let x = 0; x < size; x++) {
      const d = Math.min(
        segDist(x, y, u(0.28), u(0.32), u(0.48), u(0.5)),
        segDist(x, y, u(0.48), u(0.5), u(0.28), u(0.68)),
        segDist(x, y, u(0.55), u(0.68), u(0.74), u(0.68)),
      );
      const a = Math.max(0, Math.min(1, w / 2 - d + 0.5)); // antialias simple
      const o = y * row + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) fs.writeFileSync(path.join(OUT, `icon-${s}.png`), icon(s));
console.log('íconos generados en public/');
