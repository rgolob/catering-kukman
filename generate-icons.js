// Generates public/icon-192.png and public/icon-512.png
// No external dependencies — pure Node.js
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

// Simple 5×7 bitmap glyphs for C and K
const GLYPHS = {
  C: [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,1],
    [0,1,1,1,0],
  ],
  K: [
    [1,0,0,1,0],
    [1,0,1,0,0],
    [1,1,0,0,0],
    [1,1,0,0,0],
    [1,0,1,0,0],
    [1,0,0,1,0],
    [1,0,0,0,1],
  ],
};

function makePNG(size) {
  const bg = [26, 54, 93];   // #1a365d
  const fg = [255, 255, 255];

  // Scale glyph pixels to ~30% of icon size, with gap between letters
  const glyphH = 7, glyphW = 5;
  const scale = Math.floor(size * 0.28 / glyphH);
  const gap   = Math.max(1, Math.floor(scale * 1.2));
  const blockW = glyphW * scale;
  const totalW = blockW * 2 + gap;
  const totalH = glyphH * scale;
  const offX   = Math.floor((size - totalW) / 2);
  const offY   = Math.floor((size - totalH) / 2);

  // Pixel buffer (RGBA-style but we only store RGB)
  const px = (x, y) => (y * size + x) * 3;
  const buf = Buffer.alloc(size * size * 3);
  // Fill background
  for (let i = 0; i < size * size; i++) {
    buf[i*3] = bg[0]; buf[i*3+1] = bg[1]; buf[i*3+2] = bg[2];
  }

  function drawGlyph(letter, startX) {
    const rows = GLYPHS[letter];
    rows.forEach((row, gy) => {
      row.forEach((bit, gx) => {
        if (!bit) return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = startX + gx * scale + dx;
            const y = offY   + gy * scale + dy;
            if (x < 0 || x >= size || y < 0 || y >= size) return;
            const p = px(x, y);
            buf[p] = fg[0]; buf[p+1] = fg[1]; buf[p+2] = fg[2];
          }
        }
      });
    });
  }

  drawGlyph('C', offX);
  drawGlyph('K', offX + blockW + gap);

  // Build PNG raw data (filter byte + RGB per row)
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // no filter
    buf.copy(raw, y * rowLen + 1, y * size * 3, (y + 1) * size * 3);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, 'public');
fs.writeFileSync(path.join(out, 'icon-192.png'), makePNG(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), makePNG(512));
console.log('Icons created: icon-192.png, icon-512.png');
