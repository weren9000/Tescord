const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const data = await page.evaluate(
      async (source) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + source;
        await img.decode();
        const scan = document.createElement('canvas');
        scan.width = img.width;
        scan.height = img.height;
        const ctx = scan.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
        let left = img.width,
          top = img.height,
          right = 0,
          bottom = 0,
          clear = 0;
        for (let y = 0; y < img.height; y++)
          for (let x = 0; x < img.width; x++) {
            const a = pixels[(y * img.width + x) * 4 + 3];
            if (a === 0) clear++;
            if (a > 16) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        if (clear < img.width * img.height * 0.01) throw Error('Master needs transparent corners');
        const out = document.createElement('canvas');
        out.width = out.height = 512;
        const paint = out.getContext('2d');
        paint.imageSmoothingQuality = 'high';
        paint.drawImage(img, left, top, right - left + 1, bottom - top + 1, 0, 0, 512, 512);
        return out.toDataURL('image/webp', 0.94).split(',')[1];
      },
      fs
        .readFileSync(path.join(root, 'docs/design/floating-navigation/master.png'))
        .toString('base64'),
    );
    fs.writeFileSync(
      path.join(root, 'frontend/public/assets/enamel-navigation/floating-panel.webp'),
      Buffer.from(data, 'base64'),
    );
    console.log('Exported floating-panel.webp, 512px with original alpha');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
