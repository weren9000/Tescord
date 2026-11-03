// Keep existing status-image URLs stable while sharing the application's glyphs.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mod = { exports: {} };
require('node:vm').runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, '../src/app/shared/painted-controls/painted-glyphs.ts'),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: mod.exports },
);
const glyphs = mod.exports.PAINTED_GLYPHS;
const targets = [
  ['src/assets/mic.svg', 'mic', '#9f8abb'],
  ['src/assets/mic_off.svg', 'micOff', '#9f8abb'],
  ['src/assets/mic_block.svg', 'micOff', '#dc5674'],
  ['src/assets/mic_voice.svg', 'mic', '#26a99c'],
  ['src/assets/push_on.svg', 'bell', '#9f8abb'],
  ['src/assets/push_off.svg', 'bellOff', '#9f8abb'],
  ['public/assets/coin.svg', 'coin', '#c99c48'],
  ['public/assets/crystal.svg', 'crystal', '#9c76df'],
];
for (const [file, name, color] of targets) {
  const glyph = glyphs[name];
  const body = glyph.body ? `<path fill="${color}" fill-rule="evenodd" d="${glyph.body}"/>` : '';
  const line = glyph.line
    ? `<path fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" d="${glyph.line}"/>`
    : '';
  fs.writeFileSync(
    path.join(__dirname, '..', file),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}${line}</svg>\n`,
  );
}
console.log(`Exported ${targets.length} status and currency glyphs.`);
