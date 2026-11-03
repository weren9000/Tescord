// Keep the public HTML readable without JavaScript, using the same content as Angular.
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const header = fs
  .readFileSync(path.join(root, 'src/app/landing/guest-header.component.html'), 'utf8')
  .replace(/@if \(showLogin\(\)\) \{[\s\S]*?\}/, '');
const glyphModule = { exports: {} };
require('node:vm').runInNewContext(
  require('typescript').transpileModule(
    fs.readFileSync(path.join(root, 'src/app/shared/painted-controls/painted-glyphs.ts'), 'utf8'),
    { compilerOptions: { module: require('typescript').ModuleKind.CommonJS } },
  ).outputText,
  { exports: glyphModule.exports },
);
const paintedGlyph = (name) => {
  const glyph = glyphModule.exports.PAINTED_GLYPHS[name];
  if (!glyph) throw new Error('Unknown painted glyph: ' + name);
  return `<span class="kva-painted-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${glyph.body}" fill="currentColor" fill-rule="evenodd"/><path d="${glyph.line}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
};
const html = fs
  .readFileSync(path.join(root, 'src/app/landing/landing.component.html'), 'utf8')
  .replace(/<div class="landing"[^>]*>/, '<div class="landing" data-static-landing>')
  .replace(/<kva-painted-glyph\s+name="(\w+)"\s*\/>/g, (_, name) => paintedGlyph(name))
  .replace(/<kva-painted-glyph\s+\[name\]="demoMic\(\)[^"]*"\s*\/>/g, () => paintedGlyph('mic'))
  .replace(/<kva-painted-glyph\s+\[name\]="demoCamera\(\)[^"]*"\s*\/>/g, () =>
    paintedGlyph('cameraOff'),
  )
  .replace(
    /<button\b([^>]*\bkvaPainted\b[^>]*)>/g,
    (_, attrs) =>
      `<button class="kva-painted-button${/\biconOnly\b/.test(attrs) ? ' kva-painted-button--round' : ''}" ${attrs.replace(/\bkvaPainted\b|\biconOnly\b/g, '')}>`,
  )
  .replace(/\{\{\s*demoMic\(\)\s*\?[^}]+\}\}/g, 'включён')
  .replace(/\{\{\s*demoCamera\(\)\s*\?[^}]+\}\}/g, 'выключена')
  .replace('class="demo-screen-preview"', 'class="demo-screen-preview" hidden')
  .replace('<app-guest-header [showLogin]="false" />', header)
  .replace(/<app-ui-icon\s+name="(\w+)"\s*\/>/g, (_, name) => paintedGlyph(name))
  .replace(
    /<app-news-feed[^>]*\/>/,
    '<p class="landing-help">Новости загружаются при открытии страницы.</p><noscript><p>Для просмотра новостей включите JavaScript.</p></noscript>',
  )
  .replace(/\s(?:\[[^\]]+\]|\([^)]+\))="[^"]*"/g, '')
  .replace(/\s#pictureDialog/g, '')
  .replace(/<button\b/g, '<button disabled');
const css =
  fs.readFileSync(path.join(root, 'src/app/landing/landing.component.css'), 'utf8') +
  fs.readFileSync(path.join(root, 'src/app/landing/guest-header.component.css'), 'utf8') +
  fs.readFileSync(path.join(root, 'src/app/landing/cosmic-theme.css'), 'utf8') +
  fs.readFileSync(path.join(root, 'src/app/shared/painted-controls/painted-controls.css'), 'utf8') +
  fs.readFileSync(path.join(root, 'src/app/landing/cosmic-motion.css'), 'utf8') +
  fs.readFileSync(path.join(root, 'src/app/landing/cosmic-chapters.css'), 'utf8');
const index = path.join(root, 'src/index.html');
let source = fs.readFileSync(index, 'utf8');
source = source.replace(
  /<app-root\b[^>]*>[\s\S]*?<\/app-root>/,
  `<app-root><style>${css}</style>${html}</app-root>`,
);
const prettier = require('prettier');
prettier
  .resolveConfig(index)
  .then((options) => prettier.format(source, { ...options, filepath: index }))
  .then((formatted) => fs.writeFileSync(index, formatted))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
