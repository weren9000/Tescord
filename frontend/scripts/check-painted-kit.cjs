const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
(async () => {
  const out = path.resolve(__dirname, '../../artifacts/painted-controls');
  const browser = await chromium.launch();
  const errors = [];
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
    await page.locator('#primary').waitFor();
    await page.evaluate(() =>
      Promise.all([...document.images].filter((i) => i.loading !== 'lazy').map((i) => i.decode())),
    );
    await page.locator('#primary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#click-count')).toHaveText(/1$/);
    await page.keyboard.press('Space');
    await expect(page.locator('#click-count')).toHaveText(/2$/);
    assert.equal(await page.locator('#disabled').isDisabled(), true);
    await page.locator('#disabled').evaluate((b) => b.click());
    assert.match(await page.locator('#click-count').innerText(), /2$/);
    await page.locator('#mic-toggle').click();
    await expect(page.locator('#mic-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(page.locator('#mic-toggle')).toHaveAttribute('aria-pressed', 'true');
    const before = await page.locator('#loading').boundingBox();
    await page.locator('#loading').click();
    await expect(page.locator('#loading')).toHaveAttribute('aria-busy', 'true');
    assert.equal(await page.locator('#loading').isDisabled(), true);
    const after = await page.locator('#loading').boundingBox();
    assert.equal(before.width, after.width);
    assert.equal(before.height, after.height);
    await page.locator('#loading').evaluate(async (b) => {
      while (b.disabled) await new Promise((r) => setTimeout(r, 50));
    });
    await page.locator('#form-default').click();
    assert.match(await page.locator('#submit-count').innerText(), /0$/);
    await page.locator('#form-submit').click();
    await expect(page.locator('#submit-count')).toHaveText(/1$/);
    checks.push('Native Enter/Space, disabled, toggle, loading size stability, form button/submit');
    const inventory = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
    assert.deepEqual(inventory.summary.missingLegacy, []);
    assert.equal(inventory.mappings.length, 55);
    await expect(page.locator('.glyph-grid figure')).toHaveCount(inventory.summary.newGlyphs);
    await expect(page.locator('.art-grid figure')).toHaveCount(20);
    await page.locator('input[type="search"]').fill('zoom');
    await expect(page.locator('.glyph-grid figure')).toHaveCount(2);
    await page.locator('input[type="search"]').fill('no-such-icon');
    await expect(page.locator('.glyph-grid figure')).toHaveCount(0);
    await page.locator('input[type="search"]').fill('');
    await page.locator('#wrap-toggle').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#wrap-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.control-example pre')).toHaveCSS('white-space', 'pre-wrap');
    await page.locator('#new-controls .kva-painted-button--tab').nth(1).click();
    await expect(page.locator('#new-controls .kva-painted-button--tab').nth(1)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#new-controls .kva-painted-button--tab').first()).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.locator('.compact-toolbar button').first().click();
    await expect(page.locator('#kit-notice')).toContainText('Ответить');
    for (const selector of ['.art-grid', '#new-controls', '#light-controls', '#migration']) {
      await page
        .locator(selector)
        .screenshot({ path: path.join(out, selector.replace(/^[.#]/, '') + '-1440.png') });
    }
    checks.push(
      '55 legacy keys covered, 20 artworks decoded, glyph filtering, quiet actions and section toggles',
    );
    for (const width of [1440, 1024, 393, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Overflow at ' + width,
      );
      await page.screenshot({ path: path.join(out, 'preview-' + width + '.png'), fullPage: true });
    }
    checks.push('No horizontal overflow: 320, 393, 1024, 1440');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#loading').click();
    assert.equal(
      await page
        .locator('#loading .kva-painted-spinner')
        .evaluate((e) => getComputedStyle(e).animationName),
      'none',
    );
    await page.locator('#loading').evaluate(async (b) => {
      while (b.disabled) await new Promise((r) => setTimeout(r, 50));
    });
    await page.emulateMedia({ forcedColors: 'active' });
    await page.locator('#primary').focus();
    await page.keyboard.press('Tab');
    assert.equal(
      await page.locator('#primary').evaluate((e) => getComputedStyle(e, '::before').display),
      'none',
    );
    const focus = await page.evaluate(() => ({
      style: getComputedStyle(document.activeElement).outlineStyle,
      width: getComputedStyle(document.activeElement).outlineWidth,
    }));
    assert.notEqual(focus.style, 'none');
    assert.notEqual(focus.width, '0px');
    checks.push('Reduced motion, forced colours, visible keyboard focus');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, 'verification.json'),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(checks.join('\n'));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
