// Draws Gany with the app's own engine and writes the icons:
//   assets/icon.png (256), assets/tray.png (32), assets/icon.ico (16–256)
// Run with: npm run icons   (it runs under Electron to get a real canvas)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** ICO with PNG-compressed entries (Vista+). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'), { query: { icons: '1' } }).catch(() => {});
  const urls = await win.webContents.executeJavaScript(`
    import('./gany.js').then(({ Gany }) => {
      const out = {};
      for (const size of ${JSON.stringify(SIZES)}) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = new Gany(c);
        // Icons crop a little tighter than the island so Gany fills the square.
        const ctx = c.getContext('2d');
        ctx.translate(-size * 0.08, -size * 0.12);
        ctx.scale(1.16, 1.16);
        g.draw(1000, ctx, size);
        out[size] = c.toDataURL('image/png');
      }
      return out;
    })
  `);
  const pngs = SIZES.map((size) => ({ size, data: Buffer.from(urls[size].split(',')[1], 'base64') }));
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), pngs.find((p) => p.size === 256).data);
  fs.writeFileSync(path.join(ROOT, 'assets', 'tray.png'), pngs.find((p) => p.size === 32).data);
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), ico(pngs));
  console.log('icons written to assets/');
  app.quit();
});
