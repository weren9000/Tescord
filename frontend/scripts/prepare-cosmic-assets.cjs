// Delivery encoding only; original ImageGen artwork is kept in artifacts/cosmic-originals.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'artifacts/cosmic-originals');
const target = path.join(root, 'frontend/public/assets/cosmic');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const name of ['hero', 'kvak', 'zhabik', 'lilya', 'bolot']) {
      const input = fs.readFileSync(path.join(source, name + '.png'));
      const encoded = await page.evaluate(
        async ({ data, maxWidth }) => {
          const image = new Image();
          image.src = 'data:image/png;base64,' + data;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(maxWidth, image.naturalWidth);
          canvas.height = Math.round((image.naturalHeight * canvas.width) / image.naturalWidth);
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          return {
            data: canvas.toDataURL('image/webp', 0.9).split(',')[1],
            width: canvas.width,
            height: canvas.height,
          };
        },
        { data: input.toString('base64'), maxWidth: name === 'hero' ? 1920 : 256 },
      );
      const bytes = Buffer.from(encoded.data, 'base64');
      fs.writeFileSync(path.join(target, name + '.webp'), bytes);
      console.log(`${name}: ${encoded.width} × ${encoded.height}, ${bytes.length} bytes`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
