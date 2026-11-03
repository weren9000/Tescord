const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const front = path.join(root, 'frontend');
const out = path.join(root, 'artifacts/painted-controls');
const components = path.join(front, 'src/app/shared/painted-controls');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  cp.execFileSync(process.execPath, [path.join(__dirname, 'audit-ui-kit.cjs')], {
    cwd: front,
    stdio: 'inherit',
  });
  fs.copyFileSync(
    path.join(root, 'docs/design/painted-controls/inventory.json'),
    path.join(out, 'inventory.json'),
  );
  cp.execFileSync(
    process.execPath,
    [
      path.join(front, 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js'),
      '-p',
      path.join(__dirname, 'painted-demo/tsconfig.json'),
    ],
    { cwd: front, stdio: 'inherit' },
  );
  const compiled = path.join(root, 'artifacts/painted-compiled/scripts/painted-demo/main.js');
  await require('esbuild').build({
    entryPoints: [compiled],
    bundle: true,
    format: 'iife',
    outfile: path.join(out, 'catalogue.js'),
    nodePaths: [path.join(front, 'node_modules')],
    minify: true,
    plugins: [
      {
        name: 'relative-art-paths',
        setup(build) {
          build.onLoad({ filter: /painted-button\.component\.js$/ }, (args) => ({
            contents: fs
              .readFileSync(args.path, 'utf8')
              .replaceAll('/assets/painted-controls/', './assets/'),
            loader: 'js',
          }));
        },
      },
    ],
  });
  fs.cpSync(path.join(front, 'public/assets/painted-controls'), path.join(out, 'assets'), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(root, 'docs/design/painted-controls/reference.png'),
    path.join(out, 'reference.png'),
  );
  fs.copyFileSync(
    path.join(__dirname, 'painted-demo/catalogue.css'),
    path.join(out, 'catalogue.css'),
  );
  fs.writeFileSync(
    path.join(out, 'painted-controls.css'),
    fs
      .readFileSync(path.join(components, 'painted-controls.css'), 'utf8')
      .replaceAll('/assets/painted-controls/', './assets/'),
  );
  const ts = require('typescript');
  const mod = { exports: {} };
  const source = ts.transpileModule(
    fs.readFileSync(path.join(components, 'painted-glyphs.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  require('node:vm').runInNewContext(source, { exports: mod.exports });
  const glyphs = mod.exports.PAINTED_GLYPHS;
  fs.mkdirSync(path.join(out, 'svg'), { recursive: true });
  const symbols = [];
  for (const [name, glyph] of Object.entries(glyphs)) {
    const body = `<path d="${glyph.body}" fill="currentColor" fill-rule="evenodd"/><path d="${glyph.line}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
    fs.writeFileSync(
      path.join(out, 'svg', name + '.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" color="#fff0d2">${body}</svg>`,
    );
    symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`);
  }
  fs.writeFileSync(
    path.join(out, 'svg/sprite.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`,
  );
  fs.writeFileSync(
    path.join(out, 'index.html'),
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Квачат — рисованные иконки и кнопки</title><link rel="stylesheet" href="catalogue.css"><body><painted-demo></painted-demo><script src="catalogue.js"></script></body></html>',
  );
  fs.cpSync(components, path.join(out, 'angular'), { recursive: true });
  const guide = path.join(root, 'docs/design/painted-controls/README.md');
  if (fs.existsSync(guide)) fs.copyFileSync(guide, path.join(out, 'README.md'));
  for (const file of ['migration.md', 'expansion-generation.json']) {
    fs.copyFileSync(path.join(root, 'docs/design/painted-controls', file), path.join(out, file));
  }
  console.log(
    'Built ' +
      out +
      ' with ' +
      Object.keys(glyphs).length +
      ' SVG glyphs and actual Angular components.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
