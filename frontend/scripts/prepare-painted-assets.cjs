// Normalise transparent padding and delivery sizes; preserve the ImageGen PNG masters.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'artifacts/painted-controls-originals');
const target = path.join(root, 'frontend/public/assets/painted-controls');
const names = [
  'room',
  'friends',
  'groups',
  'platforms',
  'chat',
  'files',
  'mic',
  'headphones',
  'camera',
  'screen',
  'bell',
  'settings',
  'applications',
  'inventory',
  'shop',
  'gift',
  'appearance',
  'profile',
  'security',
  'calendar',
  'button-primary',
  'button-secondary',
  'button-danger',
  'button-pressed',
  'button-round',
  'button-round-active',
  'button-round-danger',
  'panel',
];
(async () => {
  fs.mkdirSync(target, { recursive: true });
  const browser = await chromium.launch();
  const manifest = { reference: 'docs/design/painted-controls/reference.png', assets: [] };
  try {
    const page = await browser.newPage();
    for (const name of names) {
      const input = fs.readFileSync(path.join(source, name + '.png'));
      const asset = await page.evaluate(
        async ({ data, name }) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + data;
          await img.decode();
          const scan = document.createElement('canvas');
          scan.width = img.width;
          scan.height = img.height;
          const ctx = scan.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, scan.width, scan.height).data;
          let left = scan.width,
            top = scan.height,
            right = 0,
            bottom = 0,
            clear = 0;
          for (let y = 0; y < scan.height; y++)
            for (let x = 0; x < scan.width; x++) {
              const alpha = pixels[(y * scan.width + x) * 4 + 3];
              if (alpha === 0) clear++;
              if (alpha > 16) {
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
              }
            }
          if (clear < scan.width * scan.height * 0.01)
            throw new Error(name + ': missing transparency');
          const cw = right - left + 1,
            ch = bottom - top + 1;
          const surface = name.startsWith('button-') || name === 'panel';
          const round = name.includes('round');
          const sizes = surface ? [round ? 256 : 1024] : [128, 256, 512];
          const outputs = [];
          for (const size of sizes) {
            const out = document.createElement('canvas');
            const pad = surface ? 2 : Math.round(size * 0.035);
            out.width = size;
            out.height = surface && !round ? Math.round((size * ch) / cw) + 4 : size;
            const scale = Math.min((out.width - pad * 2) / cw, (out.height - pad * 2) / ch);
            const paint = out.getContext('2d');
            paint.imageSmoothingQuality = 'high';
            paint.drawImage(
              img,
              left,
              top,
              cw,
              ch,
              (out.width - cw * scale) / 2,
              (out.height - ch * scale) / 2,
              cw * scale,
              ch * scale,
            );
            outputs.push({
              size,
              width: out.width,
              height: out.height,
              data: out.toDataURL('image/webp', 0.94).split(',')[1],
            });
          }
          return {
            sourceSize: [img.width, img.height],
            crop: [left, top, cw, ch],
            transparent: true,
            outputs,
          };
        },
        { data: input.toString('base64'), name },
      );
      const files = [];
      for (const out of asset.outputs) {
        const file = name + (asset.outputs.length > 1 ? '-' + out.size : '') + '.webp';
        const bytes = Buffer.from(out.data, 'base64');
        fs.writeFileSync(path.join(target, file), bytes);
        files.push({ file, width: out.width, height: out.height, bytes: bytes.length });
      }
      manifest.assets.push({
        name,
        sourceSize: asset.sourceSize,
        crop: asset.crop,
        transparent: asset.transparent,
        files,
      });
      console.log(name + ': ' + files.map((f) => f.file + ' ' + f.bytes + ' B').join(', '));
    }
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
