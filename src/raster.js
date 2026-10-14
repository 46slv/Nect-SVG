import {
  checkImageSize,
  sourceImageSize,
  pngSize,
  encodeImage,
  imageURL,
  MAX_IMAGE_BYTES,
} from './images.js';
/** Browser adapter: core export scene remains DOM-free and renderer-independent. */
export async function loadImage(url) {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw Error('Image could not be decoded');
  }
  checkImageSize(image.naturalWidth, image.naturalHeight);
  return image;
}
function pngBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) reject(Error('PNG encoding failed'));
      else resolve(blob);
    }, 'image/png'),
  );
}
export async function prepareImage(file) {
  if (file.size > MAX_IMAGE_BYTES) throw Error('Image exceeds 12 MB');
  const bytes = await file.arrayBuffer();
  const info = sourceImageSize(bytes); // Bound dimensions before the decoder allocates pixels.
  const url = URL.createObjectURL(new Blob([bytes], { type: info.mime }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const blob = await pngBlob(canvas),
      data = await blob.arrayBuffer();
    const size = pngSize(data);
    return { name: file.name.slice(0, 500), mime: 'image/png', ...size, data: encodeImage(data) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function preflightImages(doc) {
  for (const asset of Object.values(doc.imageAssets || {})) {
    const image = await loadImage(imageURL(asset));
    if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height)
      throw Error('Decoded image dimensions do not match');
  }
}
export function pngDimensions(doc, scale) {
  if (!Number.isFinite(scale) || scale < 0.1 || scale > 8)
    throw Error('PNG scale must be between 0.1× and 8×');
  return checkImageSize(
    Math.max(1, Math.round(doc.width * scale)),
    Math.max(1, Math.round(doc.height * scale)),
  );
}
export async function rasterizeSVG(svg, size) {
  checkImageSize(size.width, size.height);
  const scaled = svg.replace(
    /width="[^"]+" height="[^"]+"/,
    `width="${size.width}" height="${size.height}"`,
  );
  const url = URL.createObjectURL(new Blob([scaled], { type: 'image/svg+xml' }));
  try {
    const image = await loadImage(url),
      canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
    return await pngBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
