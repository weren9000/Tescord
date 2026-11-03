// Export approved ImageGen master without repainting or changing its alpha.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const names = [
  'room',
  'friends',
  'groups',
  'platforms',
  'inventory',
  'applications',
  'security',
  'search',
  'bell',
  'menu',
];
(async () => {
  const target = path.join(root, 'frontend/public/assets/enamel-navigation');
  fs.mkdirSync(target, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const assets = await page.evaluate(
      async ({ data, names }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + data;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
        const columns = [0, 0.217, 0.405, 0.597, 0.791, 1];
        return names.map((name, i) => {
          const x0 = Math.round(columns[i % 5] * img.width);
          const x1 = Math.round(columns[(i % 5) + 1] * img.width);
          const y0 = i < 5 ? 0 : Math.round(img.height * 0.49);
          const y1 = i < 5 ? Math.round(img.height * 0.49) : img.height;
          let left = x1,
            right = x0,
            top = y1,
            bottom = y0,
            clear = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const a = pixels[(y * img.width + x) * 4 + 3];
              if (a === 0) clear++;
              if (a > 16) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
            }
          if (clear < (x1 - x0) * (y1 - y0) * 0.05 || right <= left)
            throw new Error(name + ': invalid alpha/crop');
          const w = right - left + 1,
            h = bottom - top + 1;
          const outputs = [128, 256, 512].map((size) => {
            const out = document.createElement('canvas');
            out.width = out.height = size;
            const paint = out.getContext('2d');
            paint.imageSmoothingQuality = 'high';
            const scale = (size * 0.94) / Math.max(w, h);
            paint.drawImage(
              img,
              left,
              top,
              w,
              h,
              (size - w * scale) / 2,
              (size - h * scale) / 2,
              w * scale,
              h * scale,
            );
            return { size, data: out.toDataURL('image/webp', 0.94).split(',')[1] };
          });
          return { name, crop: [left, top, w, h], outputs };
        });
      },
      {
        data: fs
          .readFileSync(path.join(root, 'docs/design/enamel-navigation/master.png'))
          .toString('base64'),
        names,
      },
    );
    for (const asset of assets)
      for (const out of asset.outputs)
        fs.writeFileSync(
          path.join(target, `${asset.name}-${out.size}.webp`),
          Buffer.from(out.data, 'base64'),
        );
    fs.writeFileSync(
      path.join(target, 'manifest.json'),
      JSON.stringify(
        {
          source: 'docs/design/enamel-navigation/master.png',
          assets: assets.map(({ name, crop }) => ({ name, crop })),
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Exported ' + assets.length + ' transparent icons at 128/256/512 px.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
