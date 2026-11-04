// Export the same original paths used by Angular, so nav images cannot drift.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/app/shared/celestial-glyphs.ts'), 'utf8');
const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const context = { exports: {} };
vm.runInNewContext(result.outputText, context);
const glyphs = context.exports.CELESTIAL_GLYPHS;
const aliases = { security: 'avatarAdmin', install: 'download' };
for (const [name, glyph] of Object.entries({
  ...glyphs,
  ...Object.fromEntries(
    Object.entries(aliases).map(([name, original]) => [name, glyphs[original]]),
  ),
})) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#d6caef" fill-rule="evenodd" d="${glyph.body}"/><path fill="none" stroke="#d6caef" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${glyph.line}"/><path fill="none" stroke="#82cbd2" stroke-width="2" stroke-linecap="round" d="${glyph.accent}"/></svg>`;
  fs.writeFileSync(path.join(root, 'public/assets/constellation', `${name}.svg`), svg);
}
