// Read-only source inventory; output is documentation, never application code.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function objectConstant(file, name) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  let result = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      let init = node.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      result = Object.fromEntries(
        init.properties.map((p) => [
          p.name.getText(source).replace(/['"]/g, ''),
          ts.isStringLiteral(p.initializer) ? p.initializer.text : '',
        ]),
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
const old = JSON.parse(read('docs/design/painted-controls/legacy-glyphs.json'));
const calendar = objectConstant('plugins/game-calendar/game_calendar/web/icons.js', 'glyphs');
const fresh = objectConstant(
  'frontend/src/app/shared/painted-controls/painted-glyphs.ts',
  'PAINTED_GLYPHS',
);
const areas = [
  'frontend/src/app',
  'plugins/game-calendar/game_calendar/web',
  'plugins/islands/web',
  'desktop/ui',
];
const records = [];
function scan(dir) {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = dir + '/' + item.name;
    if (item.isDirectory()) {
      if (!['assets', 'node_modules', 'dist'].includes(item.name)) scan(file);
      continue;
    }
    if (!/\.(html|ts|js)$/.test(file) || /\.spec\.ts$/.test(file)) continue;
    const source = read(file);
    const tags =
      /<(button|a|app-ui-icon|kva-painted-glyph|kva-painted-art|svg|span|div)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
    for (const match of source.matchAll(tags)) {
      const tag = match[0],
        kind = match[1];
      if (['span', 'div'].includes(kind) && !/\(click\)|onclick/.test(tag)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      const literalName = tag.match(/(?:\s)name="([^"]+)"/)?.[1];
      const dynamicName = tag.match(/\[name\]="([^"]+)"/)?.[1];
      const label = tag.match(/(?:aria-label|title)="([^"]+)"/)?.[1];
      const snippet = source
        .slice(match.index + tag.length, match.index + tag.length + 220)
        .split(/<\/(?:button|a)>/)[0]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      records.push({
        file,
        line,
        kind,
        name: literalName || null,
        expression: dynamicName || null,
        label: label || null,
        snippet,
        status:
          kind === 'app-ui-icon'
            ? dynamicName
              ? 'review-dynamic'
              : literalName in fresh
                ? 'ready'
                : 'missing'
            : kind === 'svg'
              ? 'review-purpose'
              : 'review-context',
      });
    }
  }
}
areas.forEach(scan);
const dynamicSources = {
  'frontend/src/app/workspace/platform-chats.component.html':
    'frontend/src/app/workspace/platform-chats.component.ts',
  'frontend/src/app/workspace/section-navigation.component.ts':
    'frontend/src/app/workspace/section-navigation.component.ts',
  'frontend/src/app/workspace/shop.component.html': 'frontend/src/app/workspace/shop.component.ts',
};
for (const record of records.filter((r) => r.expression)) {
  const literals = [...record.expression.matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((name) => name in old || name in fresh);
  const sourceFile = dynamicSources[record.file];
  const options = literals.length
    ? literals
    : sourceFile
      ? [...read(sourceFile).matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1])
      : [];
  record.possibleGlyphs = [...new Set(options)];
  record.covered = options.length > 0 && options.every((name) => name in fresh);
  record.resolutionSource = literals.length ? 'expression-literals' : sourceFile || null;
}
const nativeBrandAssets = [];
function nativeFiles(dir) {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = dir + '/' + item.name;
    if (item.isDirectory()) nativeFiles(file);
    else if (/(?:launcher|splash|favicon|kva-app|wordmark|apple-touch)/i.test(item.name))
      nativeBrandAssets.push(file);
  }
}
nativeFiles('mobile/android/app/src/main/res');
for (const dir of ['frontend/public', 'frontend/public/assets']) {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (item.isFile() && /(?:favicon|kva-app|wordmark|apple-touch)/i.test(item.name))
      nativeBrandAssets.push(dir + '/' + item.name);
  }
}
const mappings = Object.entries(old).map(([name, oldPath]) => ({
  name,
  oldPath,
  target: name,
  ready: name in fresh,
  occurrences: records
    .filter((r) => r.kind === 'app-ui-icon' && r.name === name)
    .map(({ file, line }) => ({ file, line })),
}));
const extras = Object.keys(calendar)
  .filter((name) => !(name in old))
  .map((name) => ({ name, ready: name in fresh }));
const report = {
  scope: areas,
  method:
    'Static source inventory, excluding generated builds and user assets. Source occurrences are not rendered button counts. Dynamic expressions, inline SVG purposes, native launcher resources and conditional screen reachability require contextual review before migration.',
  summary: {
    legacyGlyphs: Object.keys(old).length,
    newGlyphs: Object.keys(fresh).length,
    missingLegacy: mappings.filter((m) => !m.ready).map((m) => m.name),
    calendarExtras: extras,
  },
  mappings,
  nativeBrandAssets,
  records,
  migrationNotes: [
    'Applications and inventory require different symbols despite the current shared inventory key.',
    'Preserve user emoji, avatars, wallpaper, group art and Islands terrain/cards/pieces.',
    'Keep hidden secret-chat features hidden.',
    'Native Android launcher/splash and desktop icons need platform-specific exports; do not replace during kit preparation.',
    'Keep links as anchors; use buttons for actions. Retain explicit labels for security, money and destructive actions.',
  ],
};
const dir = path.join(root, 'docs/design/painted-controls');
fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(
  path.join(root, 'frontend/scripts/painted-demo/migration-data.ts'),
  '// Generated by scripts/audit-ui-kit.cjs.\nexport const MIGRATION = ' +
    JSON.stringify(
      mappings.map(({ name, oldPath, ready, occurrences }) => ({
        name,
        oldPath,
        ready,
        count: occurrences.length,
      })),
      null,
      2,
    ) +
    ' as const;\n',
);
cp.execFileSync(
  process.execPath,
  [
    path.join(path.dirname(require.resolve('prettier/package.json')), 'bin/prettier.cjs'),
    '--write',
    path.join(root, 'frontend/scripts/painted-demo/migration-data.ts'),
  ],
  { cwd: path.join(root, 'frontend'), stdio: 'pipe' },
);
console.log(
  JSON.stringify({
    ...report.summary,
    records: records.length,
    dynamic: records.filter((r) => r.expression).length,
  }),
);
if (report.summary.missingLegacy.length || extras.some((x) => !x.ready)) process.exitCode = 1;
