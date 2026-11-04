import { test, expect } from '@playwright/test';
import { BOTANICAL_GLYPHS } from '../src/app/shared/botanical-glyphs';

test('botanical SVG exports match shared glyphs and render at 24 and 32px', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  for (const [name, glyph] of Object.entries(BOTANICAL_GLYPHS)) {
    const response = await page.request.get(`/assets/quiet-marsh/${name}.svg`);
    expect(response.ok()).toBeTruthy();
    const svg = await response.text();
    for (const d of [glyph.body, glyph.line, glyph.accent]) expect(svg).toContain(`d="${d}"`);
  }
  await page.evaluate((names) => {
    document.body.innerHTML = '';
    document.body.style.cssText =
      'background:#101b1a;color:#a7c7ac;font:14px system-ui;padding:24px';
    const grid = document.createElement('main');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:24px';
    for (const name of names) {
      const cell = document.createElement('div');
      cell.style.cssText =
        'display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:16px;background:#182623;border-radius:12px';
      for (const size of [24, 32]) {
        const image = new Image(size, size);
        image.src = `/assets/quiet-marsh/${name}.svg`;
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
  }, Object.keys(BOTANICAL_GLYPHS));
  await page.evaluate(() =>
    Promise.all(Array.from(document.images).map((image) => image.decode())),
  );
  await page.screenshot({ path: testInfo.outputPath('botanical-all-icons.png'), fullPage: true });
});
