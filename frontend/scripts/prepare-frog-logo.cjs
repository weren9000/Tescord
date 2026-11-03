// Delivery export only: preserve artwork, trim transparent margins and resize.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const input = fs.readFileSync(
      path.join(root, 'artifacts/cosmic-motion-originals/frog-moonlight.png'),
    );
    const exports = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      let left = img.width,
        top = img.height,
        right = 0,
        bottom = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (pixels[(y * img.width + x) * 4 + 3] > 8) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const w = right - left + 1,
        h = bottom - top + 1;
      return [64, 128, 256].map((size) => {
        const output = document.createElement('canvas');
        output.width = output.height = size;
        const out = output.getContext('2d');
        out.imageSmoothingQuality = 'high';
        const scale = (size - 4) / Math.max(w, h);
        out.drawImage(
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
        return { size, data: output.toDataURL('image/webp', 0.94).split(',')[1] };
      });
    }, input.toString('base64'));
    for (const item of exports) {
      const file = path.join(
        root,
        `frontend/public/assets/cosmic/frog-moonlight-${item.size}.webp`,
      );
      fs.writeFileSync(file, Buffer.from(item.data, 'base64'));
      console.log(path.basename(file));
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
