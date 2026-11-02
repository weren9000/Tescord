// Keep the public HTML readable without JavaScript, using the same content as Angular.
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const header = fs
  .readFileSync(path.join(root, 'src/app/landing/guest-header.component.html'), 'utf8')
  .replace(/@if \(showLogin\(\)\) \{[\s\S]*?\}/, '');
// Use the same icon paths as the Angular component in the no-JavaScript fallback.
const iconSource = fs.readFileSync(
  path.join(root, 'src/app/workspace/ui-icon.component.ts'),
  'utf8',
);
const iconPaths = Object.fromEntries(
  [...iconSource.matchAll(/^\s{2}(\w+):\s*'([^']+)'/gm)].map((match) => [match[1], match[2]]),
);
const html = fs
  .readFileSync(path.join(root, 'src/app/landing/landing.component.html'), 'utf8')
  .replace('<div class="landing">', '<div class="landing" data-static-landing>')
  .replace('<app-guest-header [showLogin]="false" />', header)
  .replace(/<app-ui-icon\s+name="(\w+)"\s*\/>/g, (_, name) => {
    if (!iconPaths[name]) throw new Error('Unknown landing icon: ' + name);
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      iconPaths[name] +
      '"/></svg>'
    );
  })
  .replace(
    /<app-news-feed[^>]*\/>/,
    '<p class="landing-help">Новости загружаются при открытии страницы.</p><noscript><p>Для просмотра новостей включите JavaScript.</p></noscript>',
  )
  .replace(/\s(?:\[[^\]]+\]|\([^)]+\))="[^"]*"/g, '')
  .replace(/\s#pictureDialog/g, '')
  .replace(/<button\b/g, '<button disabled');
const css =
  fs.readFileSync(path.join(root, 'src/app/landing/landing.component.css'), 'utf8') +
  fs.readFileSync(path.join(root, 'src/app/landing/guest-header.component.css'), 'utf8');
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
