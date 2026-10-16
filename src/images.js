/** Embedded, local raster assets. No URL fetching; persisted assets are canonical PNG. */
export const MAX_IMAGE_BYTES = 12_000_000;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_TOTAL_BYTES = 24_000_000;
export function checkImageSize(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw Error('Image must be at most 8192 px per side and 16 megapixels');
  return { width, height };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (
    b.length > MAX_IMAGE_BYTES ||
    b.length < 45 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)
  )
    throw Error('Invalid PNG or image exceeds 12 MB');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8,
    size,
    data = false,
    ended = false;
  while (at + 12 <= b.length) {
    const length = v.getUint32(at),
      tag = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (at + 12 + length > b.length) throw Error('Truncated PNG');
    if (crc32(b, at + 4, at + 8 + length) !== v.getUint32(at + 8 + length))
      throw Error('PNG checksum mismatch; image is corrupt');
    if (at === 8) {
      if (tag !== 'IHDR' || length !== 13) throw Error('Invalid PNG header');
      size = checkImageSize(v.getUint32(at + 8), v.getUint32(at + 12));
    } else if (tag === 'IHDR') throw Error('Duplicate PNG header');
    if (tag === 'acTL') throw Error('Animated PNG is unsupported; use a still image');
    if (tag === 'IDAT') data = true;
    at += length + 12;
    if (tag === 'IEND') {
      ended = length === 0 && at === b.length;
      break;
    }
  }
  if (!size || !data || !ended) throw Error('Incomplete PNG');
  return size;
}
export function sourceImageSize(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length > MAX_IMAGE_BYTES) throw Error('Image exceeds 12 MB');
  if (b[0] === 137) return { ...pngSize(b), mime: 'image/png' };
  if (b.length < 4 || b[0] !== 255 || b[1] !== 216) throw Error('Choose a PNG or JPEG image');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 2;
  while (at < b.length) {
    if (b[at++] !== 255) break;
    while (b[at] === 255) at++;
    const tag = b[at++];
    if (tag === 217 || tag === 218) break;
    if (tag === 1 || (tag >= 208 && tag <= 215)) continue;
    if (at + 2 > b.length) break;
    const length = v.getUint16(at);
    if (length < 2 || at + length > b.length) break;
    if ([192, 193, 194].includes(tag)) {
      if (length < 8) break;
      return { ...checkImageSize(v.getUint16(at + 5), v.getUint16(at + 3)), mime: 'image/jpeg' };
    }
    at += length;
  }
  throw Error('Invalid or unsupported JPEG');
}
export function encodeImage(bytes) {
  const b = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < b.length; i += 8192)
    binary += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeImage(data) {
  if (
    typeof data !== 'string' ||
    data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw Error('Invalid embedded image');
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
const checked = new WeakSet();
export function validateImageAssets(assets = {}) {
  if (
    !assets ||
    typeof assets !== 'object' ||
    Array.isArray(assets) ||
    Object.keys(assets).length > 100
  )
    throw Error('Invalid image assets');
  let total = 0,
    pixels = 0;
  for (const [id, a] of Object.entries(assets)) {
    if (
      !/^image-[a-zA-Z0-9_-]{1,100}$/.test(id) ||
      !a ||
      a.mime !== 'image/png' ||
      typeof a.name !== 'string' ||
      a.name.length > 500 ||
      typeof a.data !== 'string'
    )
      throw Error('Invalid image asset');
    total += a.data.length * 0.75;
    pixels += a.width * a.height;
    if (pixels > 32_000_000) throw Error('Embedded images exceed 32 megapixels in total');
    if (total > MAX_IMAGE_TOTAL_BYTES) throw Error('Embedded images exceed 24 MB');
    if (!checked.has(a)) {
      const size = pngSize(decodeImage(a.data));
      if (a.width !== size.width || a.height !== size.height)
        throw Error('Image dimensions do not match its PNG');
      Object.freeze(a);
      checked.add(a);
    }
  }
}
export const imageURL = (asset) => `data:image/png;base64,${asset.data}`;
