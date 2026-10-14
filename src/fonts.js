import opentype from 'opentype.js';

export const MAX_FONT_BYTES = 20_000_000;
export const MAX_FONT_TOTAL_BYTES = 32_000_000;
export const MAX_PROJECT_BYTES = 50_000_000;
export const utf8ByteLength = (text) => new TextEncoder().encode(text).byteLength;
const parsed = new Map();
const fail = (message) => {
  throw Error(message);
};

function directory(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12 || bytes.byteLength > MAX_FONT_BYTES)
    fail('Font must be a TTF or OTF file up to 20 MB');
  const view = new DataView(bytes),
    signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f)
    fail('Only static TTF/OTF outlines are supported; TTC/OTC, WOFF and WOFF2 are unsupported');
  const count = view.getUint16(4),
    tables = {};
  if (!count || count > 256 || 12 + count * 16 > bytes.byteLength)
    fail('Invalid font table directory');
  for (let i = 0; i < count; i++) {
    const base = 12 + i * 16;
    const tag = String.fromCharCode(...new Uint8Array(bytes, base, 4));
    const offset = view.getUint32(base + 8),
      length = view.getUint32(base + 12);
    if (
      offset < 12 + count * 16 ||
      offset + length > bytes.byteLength ||
      Object.hasOwn(tables, tag)
    )
      fail('Invalid font table bounds');
    tables[tag] = new DataView(bytes, offset, length);
  }
  if (tables.fvar || tables.CFF2) fail('Variable fonts are unsupported; choose a static TTF/OTF');
  if (tables.COLR || tables.CBDT || tables.sbix || tables['SVG '])
    fail('Color/bitmap fonts are unsupported; choose monochrome outlines');
  if (!tables.glyf && !tables['CFF ']) fail('Font contains no supported outlines');
  if (tables.glyf) {
    if (
      !tables.head ||
      tables.head.byteLength < 54 ||
      !tables.maxp ||
      tables.maxp.byteLength < 6 ||
      !tables.loca
    )
      fail('Invalid TrueType outline tables');
    const format = tables.head.getInt16(50),
      count = tables.maxp.getUint16(4);
    if (
      ![0, 1].includes(format) ||
      !count ||
      tables.loca.byteLength < (count + 1) * (format ? 4 : 2)
    )
      fail('Invalid TrueType glyph locations');
    let previous = 0;
    for (let i = 0; i <= count; i++) {
      const offset = format ? tables.loca.getUint32(i * 4) : tables.loca.getUint16(i * 2) * 2;
      if (
        offset < previous ||
        offset > tables.glyf.byteLength ||
        (offset !== previous && offset - previous < 10)
      )
        fail('Invalid TrueType glyph bounds');
      previous = offset;
    }
  }
  const os2 = tables['OS/2'];
  if (!os2 || os2.byteLength < 10) fail('Font embedding permission metadata is missing');
  const fsType = os2.getUint16(8);
  if (fsType & 0x0202 || (fsType & 4 && !(fsType & 8)))
    fail('Font restricts editable outline embedding; choose an installable/editable font');
  return tables;
}

/** Parse only local bytes. No URL, system-font lookup or network is performed. */
export function parseFont(bytes) {
  try {
    const tables = directory(bytes),
      font = opentype.parse(bytes);
    if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0 || !font.numGlyphs)
      fail('Invalid font metrics');
    const metrics = [];
    if (tables.vhea && tables.vmtx) {
      if (tables.vhea.byteLength < 36) fail('Invalid vertical font metrics');
      const count = tables.vhea.getUint16(34),
        vmtx = tables.vmtx;
      if (
        !count ||
        count > font.numGlyphs ||
        vmtx.byteLength < count * 4 + (font.numGlyphs - count) * 2
      )
        fail('Invalid vertical font metrics');
      for (let i = 0; i < font.numGlyphs; i++)
        metrics.push({
          advance: vmtx.getUint16(Math.min(i, count - 1) * 4),
          topBearing: vmtx.getInt16(i < count ? i * 4 + 2 : count * 4 + (i - count) * 2),
        });
    }
    const origins = new Map();
    let defaultOrigin;
    if (tables.VORG) {
      const v = tables.VORG;
      if (v.byteLength < 8 || v.byteLength < 8 + v.getUint16(6) * 4)
        fail('Invalid vertical origins');
      defaultOrigin = v.getInt16(4);
      for (let i = 0; i < v.getUint16(6); i++)
        origins.set(v.getUint16(8 + i * 4), v.getInt16(10 + i * 4));
    }
    font.nectVertical = { metrics, origins, defaultOrigin };
    return font;
  } catch (e) {
    throw Error(`Cannot load font: ${e.message}`);
  }
}
function encode(bytes) {
  const array = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < array.length; i += 8192)
    text += String.fromCharCode(...array.subarray(i, i + 8192));
  return btoa(text);
}
function decode(data) {
  const text = atob(data),
    bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
function remember(data, font) {
  parsed.delete(data);
  parsed.set(data, font);
  let total = [...parsed.keys()].reduce((sum, value) => sum + value.length * 0.75, 0);
  while (parsed.size > 8 || total > MAX_FONT_TOTAL_BYTES) {
    const key = parsed.keys().next().value;
    total -= key.length * 0.75;
    parsed.delete(key);
  }
}
function assetFont(asset) {
  let font = parsed.get(asset.data);
  if (!font) {
    font = parseFont(decode(asset.data));
    remember(asset.data, font);
  }
  return font;
}
export function validateFontAssets(assets = {}) {
  if (
    !assets ||
    typeof assets !== 'object' ||
    Array.isArray(assets) ||
    Object.keys(assets).length > 8
  )
    fail('Invalid font assets (maximum 8 fonts)');
  let total = 0;
  for (const [id, asset] of Object.entries(assets)) {
    if (!/^font-[a-zA-Z0-9_-]{1,100}$/.test(id) || !asset || typeof asset !== 'object')
      fail('Invalid font asset ID');
    if (
      typeof asset.name !== 'string' ||
      asset.name.length > 256 ||
      typeof asset.fileName !== 'string' ||
      asset.fileName.length > 256
    )
      fail('Invalid font asset name');
    const data = asset.data;
    if (
      typeof data !== 'string' ||
      !data.length ||
      data.length > Math.ceil(MAX_FONT_BYTES / 3) * 4 ||
      data.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      fail('Invalid font asset data');
    const size = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    total += size;
    if (size > MAX_FONT_BYTES || total > MAX_FONT_TOTAL_BYTES)
      fail('Font assets exceed the 20 MB per-font or 32 MB total limit');
    assetFont(asset);
    Object.freeze(asset);
  }
  return assets;
}
/** Prepare first; callers commit asset + Text reference in one history transaction. */
export function makeFontAsset(bytes, fileName, existing = {}) {
  const font = parseFont(bytes),
    data = encode(bytes);
  const found = Object.entries(existing).find(([, asset]) => asset.data === data);
  if (found) return { id: found[0], asset: found[1], font: assetFont(found[1]) };
  const id = `font-${globalThis.crypto.randomUUID()}`;
  const name = font.names.fullName?.en || font.names.fontFamily?.en || fileName;
  const asset = { name: name.slice(0, 256), fileName: String(fileName).slice(0, 256), data };
  remember(data, font);
  validateFontAssets({ ...existing, [id]: asset });
  return { id, asset, font };
}
export function resolveFonts(doc, supplied = {}) {
  const fonts = { ...supplied };
  for (const [id, asset] of Object.entries(doc.fontAssets || {})) fonts[id] = assetFont(asset);
  return fonts;
}
