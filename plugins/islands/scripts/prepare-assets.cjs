const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../../../frontend/node_modules/playwright");
const { createPreviewServer } = require("./preview.cjs");

async function main() {
  const root = path.resolve(__dirname, "..");
  const sourceRoot = path.join(root, "art/source");
  const output = path.join(root, "web/assets");
  fs.mkdirSync(output, { recursive: true });
  const prompts = JSON.parse(
    fs.readFileSync(path.join(root, "art/prompts.json"), "utf8"),
  );
  for (const file of [
    "prompts-expansion.json",
    "prompts-game.json",
    "prompts-colors.json",
    "prompts-variants.json",
  ]) {
    const extra = path.join(root, "art", file);
    if (fs.existsSync(extra))
      prompts.assets.push(...JSON.parse(fs.readFileSync(extra, "utf8")).assets);
  }
  const palette = fs.readFileSync(
    path.resolve(root, "../../frontend/src/_palette.scss"),
    "utf8",
  );
  const colors = [...palette.matchAll(/^\$([\w-]+):\s*(#[0-9a-f]+);/gim)].map(
    (m) => `  --palette-${m[1]}: ${m[2]};`,
  );
  if (colors.length < 10) throw new Error("Kvachat palette could not be read");
  fs.writeFileSync(
    path.join(root, "web/palette.css"),
    "/* Generated from frontend/src/_palette.scss. */\n:root {\n" +
      colors.join("\n") +
      "\n}\n",
  );
  const server = createPreviewServer(sourceRoot);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + "/terrain-forest.png");
    const entries = [];
    for (const asset of prompts.assets) {
      const sourceFile = asset.sourceFile || asset.name + ".png";
      const maxWidth = /^(resource-|development-|card-)/.test(asset.name)
        ? 640
        : asset.name.startsWith("piece-road")
          ? 768
          : asset.transparent
            ? 384
            : 768;
      const result = await page.evaluate(
        async ({ url, maxWidth }) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          const scale = Math.min(1, maxWidth / image.naturalWidth);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.naturalWidth * scale);
          canvas.height = Math.round(image.naturalHeight * scale);
          const context = canvas.getContext("2d");
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let transparentPixels = 0;
          for (let i = 3; i < pixels.length; i += 4)
            if (pixels[i] === 0) transparentPixels++;
          return {
            width: canvas.width,
            height: canvas.height,
            transparentPixels,
            data: canvas.toDataURL("image/webp", 0.87),
          };
        },
        { url: origin + "/" + sourceFile, maxWidth },
      );
      if (
        asset.transparent &&
        result.transparentPixels < result.width * result.height * 0.05
      )
        throw new Error(`Missing real transparency: ${asset.name}`);
      const bytes = Buffer.from(result.data.split(",")[1], "base64");
      if (bytes.toString("ascii", 8, 12) !== "WEBP")
        throw new Error("Browser did not export WebP");
      fs.writeFileSync(path.join(output, asset.name + ".webp"), bytes);
      entries.push({
        id: asset.name,
        file: asset.name + ".webp",
        width: result.width,
        height: result.height,
        bytes: bytes.length,
        transparent: asset.transparent,
        transparentPixels: result.transparentPixels,
        sourceSha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(sourceRoot, sourceFile)))
          .digest("hex"),
      });
    }
    const manifest = {
      version: prompts.revision || 1,
      generator: "Built-in image_gen; browser WebP export",
      totalBytes: entries.reduce((sum, x) => sum + x.bytes, 0),
      assets: entries,
    };
    fs.writeFileSync(
      path.join(output, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        assets: entries.length,
        bytes: manifest.totalBytes,
        transparentAssets: entries.filter((x) => x.transparent).length,
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
