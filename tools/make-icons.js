#!/usr/bin/env node
/**
 * Generate the extension's toolbar icons (icons/icon{16,32,48,128}.png).
 *
 * A dark rounded tile holding a small table glyph — a green header row over
 * light body rows, split into two columns — so the icon says "table" rather
 * than "chart", and still reads at 16px.
 *
 * The PNGs are written by hand (node:zlib for the IDAT stream, zlib.crc32 for
 * the chunk checksums) so the repo keeps no image dependency; run
 * `npm run icons` to regenerate.
 */

const fs = require('node:fs')
const path = require('node:path')
const { crc32, deflateSync } = require('node:zlib')

const BG = [31, 35, 40] // dark slate, echoing GitHub's canvas
const HEADER = [63, 185, 80] // GitHub green — the table's header row
const BODY = [230, 237, 243] // near-white — the table's body rows
const CORNER = 0.22 // tile corner radius as a fraction of icon size
const SS = 4 // supersampling factor for smooth edges

const SIZES = [16, 32, 48, 128]

// The Chrome Web Store listing icon is a separate upload from the manifest
// icons, and wants different proportions: artwork at 96x96 centred in a
// 128x128 PNG, leaving 16px transparent on each side so the tile lines up with
// its neighbours in the store grid.
const STORE_SIZE = 128
const STORE_ARTWORK = 96

// The store's small promotional tile. The style guidance asks for something
// that reads as the brand rather than a screenshot, in saturated colours, that
// still works shrunk to half size — so it is the mark on a green field.
const PROMO_W = 440
const PROMO_H = 280
const PROMO_TILE = 150
const PROMO_TOP = [45, 164, 78] // #2da44e
const PROMO_BOTTOM = [26, 127, 55] // #1a7f37

const MARGIN = 0.17 // table inset from the tile edge, as a fraction of the size
const GAP = 0.065 // gap between rows/columns, as a fraction of the size
const HEADER_H = 0.3 // header row height, as a fraction of the table's height
const SPLIT = 0.42 // column split position, as a fraction of the table's width

/** Anti-aliased coverage of the rounded tile at integer pixel (x, y). */
function tileCoverage(x, y, size, radius) {
  let hits = 0
  for (let i = 0; i < SS; i++) {
    for (let j = 0; j < SS; j++) {
      const fx = x + (i + 0.5) / SS
      const fy = y + (j + 0.5) / SS
      const cx = Math.min(Math.max(fx, radius), size - radius)
      const cy = Math.min(Math.max(fy, radius), size - radius)
      if ((fx - cx) ** 2 + (fy - cy) ** 2 <= radius * radius) hits++
    }
  }
  return hits / (SS * SS)
}

/**
 * Fill colour at point (fx, fy) of the table glyph, or null for a gap.
 *
 * The table is a header row plus 2 body rows (3 on the larger sizes) and two
 * columns — the fewest elements that still read as a table once scaled down
 * to 16px.
 */
function tableColor(fx, fy, size) {
  const margin = MARGIN * size
  const width = size - 2 * margin
  const inside =
    margin <= fx && fx < margin + width && margin <= fy && fy < margin + width
  if (!inside) return null

  const rx = fx - margin
  const ry = fy - margin
  const gap = GAP * size
  const rows = size < 48 ? 2 : 3
  const headerH = HEADER_H * width
  const bodyH = (width - headerH - rows * gap) / rows

  // Rows: header, gap, body, gap, body, ...
  let isHeader
  if (ry < headerH) {
    isHeader = true
  } else {
    const offset = ry - headerH - gap
    const index = Math.floor(offset / (bodyH + gap))
    if (index >= rows || offset - index * (bodyH + gap) > bodyH) {
      return null // below the table, or inside a horizontal gap
    }
    isHeader = false
  }

  // Columns: one divider separates a label column from a value column.
  if (Math.abs(rx - SPLIT * width) < gap / 2) return null
  return isHeader ? HEADER : BODY
}

/** Render one icon as RGBA rows. */
function render(size) {
  const radius = size * CORNER
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4) // zero-filled: alpha 0 is transparent
    for (let x = 0; x < size; x++) {
      const coverage = tileCoverage(x, y, size, radius)
      if (coverage <= 0) continue
      const colour = tableColor(x + 0.5, y + 0.5, size) ?? BG
      const at = x * 4
      row[at] = colour[0]
      row[at + 1] = colour[1]
      row[at + 2] = colour[2]
      row[at + 3] = Math.round(255 * coverage)
    }
    rows.push(row)
  }
  return rows
}

/**
 * The 440x280 promotional tile: the mark centred on a green field, with the
 * tile's anti-aliased edges composited over the gradient.
 */
function renderPromo() {
  const tile = render(PROMO_TILE)
  const x0 = Math.floor((PROMO_W - PROMO_TILE) / 2)
  const y0 = Math.floor((PROMO_H - PROMO_TILE) / 2)
  const rows = []
  for (let y = 0; y < PROMO_H; y++) {
    const t = y / (PROMO_H - 1)
    const row = Buffer.alloc(PROMO_W * 4)
    for (let x = 0; x < PROMO_W; x++) {
      const at = x * 4
      for (let c = 0; c < 3; c++) {
        row[at + c] = Math.round(
          PROMO_TOP[c] + (PROMO_BOTTOM[c] - PROMO_TOP[c]) * t
        )
      }
      row[at + 3] = 255
    }
    const source = y - y0
    if (source >= 0 && source < PROMO_TILE) {
      for (let x = 0; x < PROMO_TILE; x++) {
        const alpha = tile[source][x * 4 + 3]
        if (alpha === 0) continue
        const at = (x0 + x) * 4
        const mix = alpha / 255
        for (let c = 0; c < 3; c++) {
          row[at + c] = Math.round(
            tile[source][x * 4 + c] * mix + row[at + c] * (1 - mix)
          )
        }
      }
    }
    rows.push(row)
  }
  return rows
}

/**
 * The tile artwork at `artworkSize`, centred in a transparent `canvasSize`
 * square — the padded layout the store listing icon uses.
 */
function renderPadded(canvasSize, artworkSize) {
  const offset = Math.floor((canvasSize - artworkSize) / 2)
  const art = render(artworkSize)
  const rows = []
  for (let y = 0; y < canvasSize; y++) {
    const row = Buffer.alloc(canvasSize * 4) // zero-filled: transparent
    const source = y - offset
    if (source >= 0 && source < artworkSize) art[source].copy(row, offset * 4)
    rows.push(row)
  }
  return rows
}

/** length-prefixed, CRC-suffixed PNG chunk. */
function chunk(tag, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(tag, 'latin1'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, checksum])
}

function writePng(file, width, height, rows) {
  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.concat(
    rows.map((row) => Buffer.concat([Buffer.from([0]), row]))
  )

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression method
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace method

  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  )
}

function main() {
  const outDir = path.join(__dirname, '..', 'icons')
  fs.mkdirSync(outDir, { recursive: true })
  for (const size of SIZES) {
    const file = path.join(outDir, `icon${size}.png`)
    writePng(file, size, size, render(size))
    console.log(`wrote ${file}`)
  }

  // Not part of the extension package — upload this one to the dashboard.
  const storeDir = path.join(__dirname, '..', 'store')
  fs.mkdirSync(storeDir, { recursive: true })
  const storeFile = path.join(storeDir, `icon${STORE_SIZE}.png`)
  writePng(
    storeFile,
    STORE_SIZE,
    STORE_SIZE,
    renderPadded(STORE_SIZE, STORE_ARTWORK)
  )
  console.log(`wrote ${storeFile} (store listing icon)`)

  const promoFile = path.join(storeDir, `promo-${PROMO_W}x${PROMO_H}.png`)
  writePng(promoFile, PROMO_W, PROMO_H, renderPromo())
  console.log(`wrote ${promoFile} (store promotional tile)`)
}

main()
