# SVG, PNG and local images

Editable JSON remains the source of truth. SVG and PNG are evaluated artwork exports, not project files. Nothing in this workflow uploads the artwork or fetches arbitrary image URLs.

## Export

- SVG uses the entire artboard (`width`, `height`, zero-origin `viewBox`) with no background. Text is outlined. Visible artwork layers are ordered as in the editor; hidden layers and guide layers are omitted. Selection, editing handles, grid and guides never enter the export scene.
- PNG rasterizes that same generated SVG into a transparent canvas. The toolbar offers 0.5×, 1×, 2× and 4×; its Export PNG tooltip shows resulting pixel dimensions. Dimensions round to whole pixels. SVG exports are bounded to 50 MB including repeated embedded images. PNG output is bounded to 8192 pixels per side and 16 megapixels; choose a lower multiplier for a larger artboard. A large SVG artboard can be downscaled to a valid PNG size.
- Evaluation errors abort export rather than silently dropping visible artwork. Native saves stage beside the destination before replacing it; PNG uses a bounded binary save command. Cancel leaves the document unchanged. Repeated clicks during an export do not open competing saves.

## Import and editing

Import image adds a new composition with an Image generator and Image Output. PNG and ordinary baseline/progressive JPEG are supported. WebP, GIF, APNG and SVG image input are deliberately not included in this first bounded adapter. SVG still has its separate conservative vector import.

Local images are header/checksum-checked, decoded, and normalized into PNG. This keeps browser-decoded orientation/alpha while dropping metadata and file references. Limits are 12 MB per input/embedded PNG, 8192 pixels per side, 16 megapixels per image, 24 MB of embedded PNG bytes and 32 megapixels across assets. JSON remains bounded to 50 MB including fonts and images. High-entropy JPEGs can be rejected if their normalized PNG exceeds the limit.

Image position is top-left; size is width/height. Initial placement is centered and fitted down to the artboard without upscaling. Select the Image node to move it on canvas, or edit its position/size fields. Size is independently editable, so changing aspect ratio intentionally stretches the image. Layer visibility, guide status, locking, order, Undo/Redo and JSON reload are preserved. Fill color belongs to vector paths and does not tint an image.

Image output has its own socket type. Boolean, Convert to Path, Path Remap, Text to Path and Transform continue to require Path; a raster is never implicitly traced or treated as path vertices. Pen drawing needs a vector composition. Image transforms currently use its position/size fields. Effects, raster rotation, clipping and tracing are outside this increment.

Import cancellation, decode errors, oversized files and a document changed while reading preserve the current document. Browser/native JSON open preflights embedded-image decoding before replacing the document. The DOM-free core validates the PNG structure/dimensions but does not itself implement a PNG pixel decoder.

## Roundtrip boundary and future integration

A vector-only exported SVG can be reimported when it stays inside the documented supported subset. An exported SVG containing an embedded `<image>` renders in ordinary SVG viewers and in PNG export, but this editor's conservative SVG importer **explicitly rejects it**. Reopen the saved JSON to continue editing embedded images. Unsupported SVG attributes/elements are errors, never silent approximations.

The schema-v1 extension is optional `imageAssets` plus Image/Image Output nodes; existing vector-only JSON is unchanged. Core `exportScene` and `renderElement` share the rendering representation; `images.js` owns portable asset validation; `raster.js` owns browser decoding/rasterization; `storage.js` owns browser/native delivery. Future paint/stroke/gradient/clip work can extend these boundaries without mixing UI decorations with render state. A future Nect integration remains a separate decision.

## Verification boundary

`tests/images.test.js` covers real file SVG export/reopen, embedded JSON/headless SVG, type safety, limits, scene exclusion and history. `tests/images.e2e.js` covers actual file downloads/imports, PNG dimensions and alpha/color pixels, PNG/JPEG decoding, move/Undo/Redo, guide/hidden exclusion and interrupted/error/stale flows. Synthetic tests alone are not pixel evidence. Windows Chrome CI and native WebView2 are distinct: native WebView2 dialog interaction remains unverified until exercised on a connected Windows computer.
