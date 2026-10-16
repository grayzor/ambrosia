// Images on the clipboard, with Electron 44's clipboard: asynchronous and modelled on
// the web one (read() → ClipboardItem[], getType() → Blob). The synchronous
// readImage / writeImage / availableFormats of older Electrons are gone: calling them
// throws. Text keeps clipboard.writeText / readText.

const { clipboard, nativeImage, ClipboardItem } = require('electron');

/** The clipboard's image (a Win+Maj+S capture, a copied picture) as a NativeImage, or null. */
async function readImage() {
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.includes('image/png') ? 'image/png' : item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    if (!img.isEmpty()) return img;
  }
  return null;
}

/** Does the clipboard hold an image? Never throws (false on any doubt). */
async function hasImage() {
  try {
    return await clipboard.has('image/png');
  } catch {
    return false;
  }
}

/** Puts a NativeImage on the clipboard, as PNG. */
function writeImage(img) {
  return clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
}

module.exports = { readImage, hasImage, writeImage };
