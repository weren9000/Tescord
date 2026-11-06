import { test, expect } from '@playwright/test';
import { ATLAS_GLYPHS } from '../src/app/shared/atlas-glyphs';

test('atlas SVG exports match shared glyphs and render at 24 and 32px', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  for (const [name, glyph] of Object.entries(ATLAS_GLYPHS)) {
    const response = await page.request.get(`/assets/star-atlas/${name}.svg`);
    expect(response.ok()).toBeTruthy();
    const svg = await response.text();
    for (const d of [glyph.body, glyph.line, glyph.accent]) expect(svg).toContain(`d="${d}"`);
  }
  await page.evaluate((names) => {
    document.body.innerHTML = '';
    document.body.style.cssText =
      'background:#f5e7cf;color:#4b386b;font:14px system-ui;padding:24px';
    const grid = document.createElement('main');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:24px';
    for (const name of names) {
      const cell = document.createElement('div');
      cell.style.cssText =
        'display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:16px;background:#fbf0dc;border-radius:12px';
      for (const size of [24, 32]) {
        const image = new Image(size, size);
        image.src = `/assets/star-atlas/${name}${size === 32 ? '-night' : ''}.svg`;
        if (size === 32) image.style.cssText = 'background:#171c3b;border-radius:4px;padding:4px';
        image.alt = name;
        cell.append(image);
      }
      const label = document.createElement('span');
      label.textContent = name;
      label.style.cssText = 'width:100%;text-align:center';
      cell.append(label);
      grid.append(cell);
    }
    document.body.append(grid);
  }, Object.keys(ATLAS_GLYPHS));
  await page.evaluate(() =>
    Promise.all(Array.from(document.images).map((image) => image.decode())),
  );
  await page.screenshot({ path: testInfo.outputPath('atlas-all-icons.png'), fullPage: true });
});
