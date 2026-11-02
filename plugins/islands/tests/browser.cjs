const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../../../frontend/node_modules/playwright");
const { createPreviewServer } = require("../scripts/preview.cjs");

async function main() {
  const artifacts = path.resolve(__dirname, "../../../artifacts/islands");
  fs.mkdirSync(artifacts, { recursive: true });
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#board-stage[aria-busy="false"]').waitFor();
    assert.equal(await page.locator("#asset-error").isVisible(), false);
    assert.equal(await page.locator(".tile").count(), 7);
    assert.equal(
      await page.locator("#buildings-layer .board-piece").count(),
      2,
    );
    assert.equal(await page.locator("#roads-layer .board-piece").count(), 1);
    const assets = await page.evaluate(
      async () => await (await fetch("./assets/manifest.json")).json(),
    );
    for (const id of [
      "terrain-forest",
      "terrain-mountains",
      "terrain-pasture",
      "resource-wood",
      "resource-ore",
      "piece-road",
      "piece-settlement",
      "piece-city",
    ]) {
      assert.ok(
        assets.assets.some((asset) => asset.id === id),
        `Missing prototype asset: ${id}`,
      );
    }
    assert.ok(assets.totalBytes < 6_000_000);
    assert.ok(
      assets.assets
        .filter((a) => a.transparent)
        .every((a) => a.transparentPixels > 0),
    );
    await page.screenshot({
      path: path.join(artifacts, "desktop.png"),
      fullPage: true,
    });
    await page.locator('[data-terrain="mountains"]').click();
    assert.equal(
      await page.locator("#terrain-title").textContent(),
      "Каменные вершины",
    );
    await page.locator("#terrain-art").click();
    await page.locator("#art-dialog[open]").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#art-dialog").isVisible(), false);
    assert.equal(
      await page
        .locator("#terrain-art")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.locator('[data-resource="ore"]').click();
    assert.equal(await page.locator("#art-title").textContent(), "Руда");
    await page.screenshot({ path: path.join(artifacts, "card-detail.png") });
    await page.keyboard.press("Escape");
    await page.locator('[data-piece="settlement"]').click();
    assert.equal(await page.locator(".piece-target").count(), 22);
    await page.locator(".piece-target").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#placement-bar").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#placement-bar").isVisible(), false);
    await page.locator(".piece-target").first().focus();
    await page.keyboard.press("Enter");
    await page.locator("#confirm-placement").click();
    assert.equal(
      await page.locator("#buildings-layer .board-piece").count(),
      3,
    );
    assert.equal(await page.locator(".piece-target").count(), 21);
    await page.locator("#undo").click();
    assert.equal(
      await page.locator("#buildings-layer .board-piece").count(),
      2,
    );
    await page.locator('[data-piece="road"]').click();
    assert.equal(await page.locator(".road-target").count(), 29);
    await page.locator(".road-target").first().focus();
    await page.keyboard.press("Enter");
    await page.locator("#confirm-placement").click();
    assert.equal(await page.locator("#roads-layer .board-piece").count(), 2);
    await page.locator("#reset-board").click();
    assert.equal(await page.locator("#roads-layer .board-piece").count(), 1);
    await page.locator("#zoom-in").click();
    assert.equal(await page.locator("#zoom-value").textContent(), "120%");
    await page.locator("#zoom-fit").click();
    assert.equal(await page.locator("#zoom-value").textContent(), "100%");
    const box = await page.locator("#board").boundingBox();
    const before = await page.locator("#board").getAttribute("viewBox");
    await page.mouse.move(box.x + 60, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 100, { steps: 8 });
    await page.mouse.up();
    assert.notEqual(
      await page.locator("#board").getAttribute("viewBox"),
      before,
    );
    await page.locator("#zoom-fit").click();
    await page.locator("#theme-toggle").click();
    await page.screenshot({
      path: path.join(artifacts, "desktop-light.png"),
      fullPage: true,
    });
    await page.locator("#theme-toggle").click();
    for (const width of [393, 320, 768]) {
      await page.setViewportSize({ width, height: 852 });
      await page.locator("#zoom-fit").click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const dimensions = await page.evaluate(() => ({
        body: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert.ok(
        dimensions.body <= dimensions.viewport,
        `Horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`,
      );
      await page.screenshot({
        path: path.join(artifacts, `screen-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await page.locator('[data-piece="city"]').click();
    await page.locator(".piece-target").first().focus();
    await page.keyboard.press("Enter");
    await page.locator("#placement-bar").scrollIntoViewIfNeeded();
    const confirmation = await page.locator("#placement-bar").boundingBox();
    assert.ok(
      confirmation.x >= 0 && confirmation.x + confirmation.width <= 393,
    );
    await page.screenshot({
      path: path.join(artifacts, "mobile-placement.png"),
    });
    await page.locator("#confirm-placement").click();
    assert.equal(
      await page.locator("#buildings-layer .board-piece").count(),
      3,
    );
    assert.deepEqual(errors, []);
    await page.route("**/assets/terrain-forest.webp", (route) => route.abort());
    await page.reload();
    await page.locator("#asset-error").waitFor();
    await page.locator('#board-stage[aria-busy="false"]').waitFor();
    await page.unroute("**/assets/terrain-forest.webp");
    await page.locator("#retry-assets").click();
    await page.locator('#board-stage[aria-busy="false"]').waitFor();
    assert.equal(await page.locator("#asset-error").isVisible(), false);
    console.log(
      JSON.stringify({
        result: "PASS",
        viewports: [1440, 768, 393, 320],
        assets: assets.assets.length,
        graphicsBytes: assets.totalBytes,
        browserErrors: errors,
        artifacts,
      }),
    );
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
