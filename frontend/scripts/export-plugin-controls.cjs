// Ship local resources to independent first-party apps; no Angular dependency.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ts = require('typescript');
const mod = { exports: {} };
require('node:vm').runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(root, 'frontend/src/app/shared/painted-controls/painted-glyphs.ts'),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: mod.exports },
);
const glyphs = mod.exports.PAINTED_GLYPHS;
// Independent applications consume the same geometry without Angular.
const islandGlyphs = ['appearance', 'info', 'close'];
fs.writeFileSync(
  path.join(root, 'plugins/islands/web/cosmic-glyphs.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg">${islandGlyphs
    .map((name) => {
      const { body, line } = glyphs[name];
      return `<symbol id="${name}" viewBox="0 0 24 24"><path d="${body}" fill="currentColor" fill-rule="evenodd"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>`;
    })
    .join('')}</svg>\n`,
);
const dirs = ['plugins/game-calendar/game_calendar/web', 'plugins/islands/web', 'desktop/ui'];
for (const dir of dirs) {
  const to = path.join(root, dir);
  for (const name of ['button-primary', 'button-danger', 'panel'])
    fs.copyFileSync(
      path.join(root, 'frontend/public/assets/painted-controls', name + '.webp'),
      path.join(to, 'cosmic-' + name + '.webp'),
    );
  fs.copyFileSync(
    path.join(root, 'frontend/public/assets/cosmic/frog-moonlight-128.webp'),
    path.join(to, 'cosmic-logo.webp'),
  );
}
const names = [
  'vacation',
  'trash',
  'plus',
  'check',
  'calendar',
  'filter',
  'search',
  'menu',
  'back',
  'forward',
  'close',
  'info',
  'groups',
  'expand',
  'star',
  'location',
];
const calendar = path.join(root, dirs[0], 'icons.js');
fs.writeFileSync(
  calendar,
  `// Generated from the shared cosmic glyphs by export-plugin-controls.cjs.\nconst glyphs = ${JSON.stringify(Object.fromEntries(names.map((name) => [name, glyphs[name]])), null, 2)};\nexport function icon(name) {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','ui-icon');
 const glyph=glyphs[name]||glyphs.info;
 for(const [kind,d] of Object.entries(glyph)) { const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);p.setAttribute('fill',kind==='body'?'currentColor':'none');p.setAttribute('fill-rule','evenodd');if(kind==='line'){p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','2.3');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');}svg.append(p); }
 return svg;
}\n`,
);
console.log('Exported independent plugin glyphs, textures and brand.');
