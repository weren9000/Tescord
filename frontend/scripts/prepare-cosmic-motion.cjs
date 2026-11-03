const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const out = path.join(root, 'frontend/public/assets/cosmic-motion');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    const manifest = [];
    for (const name of ['backdrop', 'company', 'planet', 'foreground']) {
      const raw = fs.readFileSync(
        path.join(root, 'artifacts/cosmic-motion-originals', name + '.png'),
      );
      for (const width of [720, 1600]) {
        const result = await p.evaluate(
          async ({ data, width }) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + data;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = width;
            c.height = Math.round((width * img.height) / img.width);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return { height: c.height, data: c.toDataURL('image/webp', 0.88).split(',')[1] };
          },
          { data: raw.toString('base64'), width },
        );
        const buf = Buffer.from(result.data, 'base64');
        fs.writeFileSync(path.join(out, name + '-' + width + '.webp'), buf);
        manifest.push({ name, width, height: result.height, bytes: buf.length });
      }
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(manifest);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
