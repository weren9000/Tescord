import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as prettier from 'prettier';

// Existing formatting debt is frozen by content, not by a blanket path ignore.
// Changed and new files must pass; CI never updates the baseline automatically.
const baseline = JSON.parse(await readFile(new URL('../format-baseline.json', import.meta.url)));
const extensions = /\.(ts|html|scss|json|mjs|cjs)$/;
async function files(dir = '.') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`.replace(/^\.\//, '');
    if (entry.isDirectory()) {
      if (
        ![
          'node_modules',
          'dist',
          '.angular',
          'public',
          'assets',
          'test-results',
          'playwright-report',
        ].includes(entry.name)
      )
        result.push(...(await files(path)));
    } else if (extensions.test(path)) result.push(path);
  }
  return result;
}
let failures = 0;
let deferred = 0;
for (const path of await files()) {
  const info = await prettier.getFileInfo(path, { ignorePath: '.prettierignore' });
  if (info.ignored) continue;
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  const options = { ...(await prettier.resolveConfig(path)), filepath: path };
  if (await prettier.check(text, options)) continue;
  if (baseline[path] === createHash('sha256').update(text).digest('hex')) {
    deferred++;
  } else {
    console.error(`Format required: ${path}`);
    failures++;
  }
}
console.log(`Formatting: ${failures} failures; ${deferred} unchanged legacy files deferred.`);
process.exitCode = failures ? 1 : 0;
