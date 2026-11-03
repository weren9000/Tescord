// Platform delivery export from the approved transparent Moonlight PNG.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const publicDir = path.join(root, 'frontend/public');
const android = path.join(root, 'mobile/android/app/src/main/res');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const png = fs.readFileSync(
      path.join(root, 'artifacts/cosmic-motion-originals/frog-moonlight.png'),
    );
    const jobs = [];
    for (const size of [192, 512])
      jobs.push({
        file: path.join(publicDir, `kva-app-${size}.png`),
        width: size,
        height: size,
        mode: 'square',
      });
    jobs.push({
      file: path.join(publicDir, 'apple-touch-icon.png'),
      width: 180,
      height: 180,
      mode: 'square',
    });
    jobs.push({
      file: path.join(publicDir, 'favicon-kva-v1.png'),
      width: 64,
      height: 64,
      mode: 'transparent',
    });
    for (const dir of fs
      .readdirSync(android, { withFileTypes: true })
      .filter((d) => d.isDirectory())) {
      for (const name of fs.readdirSync(path.join(android, dir.name))) {
        if (!/^(ic_launcher(?:_round|_foreground)?|splash|kva_logo)\.png$/.test(name)) continue;
        const file = path.join(android, dir.name, name),
          old = fs.readFileSync(file);
        jobs.push({
          file,
          width: old.readUInt32BE(16),
          height: old.readUInt32BE(20),
          mode:
            name.includes('foreground') || name === 'kva_logo.png'
              ? 'adaptive'
              : name.includes('round')
                ? 'round'
                : name === 'splash.png'
                  ? 'splash'
                  : 'square',
        });
      }
    }
    const results = await page.evaluate(
      async ({ data, jobs }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + data;
        await img.decode();
        return jobs.map((job) => {
          const c = document.createElement('canvas');
          c.width = job.width;
          c.height = job.height;
          const ctx = c.getContext('2d');
          if (job.mode !== 'transparent' && job.mode !== 'adaptive') {
            ctx.fillStyle = '#10121c';
            if (job.mode === 'round') {
              ctx.beginPath();
              ctx.arc(c.width / 2, c.height / 2, c.width / 2, 0, Math.PI * 2);
              ctx.fill();
            } else ctx.fillRect(0, 0, c.width, c.height);
          }
          const side =
            Math.min(c.width, c.height) *
            (job.mode === 'adaptive'
              ? 0.72
              : job.mode === 'splash'
                ? 0.36
                : job.mode === 'transparent'
                  ? 1
                  : 0.94);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (c.width - side) / 2, (c.height - side) / 2, side, side);
          return c.toDataURL('image/png').split(',')[1];
        });
      },
      { data: png.toString('base64'), jobs },
    );
    jobs.forEach((job, i) => fs.writeFileSync(job.file, Buffer.from(results[i], 'base64')));
    const fav = fs.readFileSync(path.join(publicDir, 'favicon-kva-v1.png'));
    const ico = Buffer.alloc(22);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(1, 4);
    ico[6] = 64;
    ico[7] = 64;
    ico.writeUInt16LE(1, 10);
    ico.writeUInt16LE(32, 12);
    ico.writeUInt32LE(fav.length, 14);
    ico.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), Buffer.concat([ico, fav]));
    fs.writeFileSync(
      path.join(publicDir, 'favicon-kva-v1.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${fav.toString('base64')}"/></svg>`,
    );
    console.log(`Exported ${jobs.length} brand images and ICO/SVG favicons.`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
