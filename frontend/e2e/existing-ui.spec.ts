import { test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
for (const [name, script, artifactDir] of [
  ['Room layout and controls', 'meeting-layout-smoke.cjs', 'room-design'],
  ['Individual audio and controls', 'participant-audio-smoke.cjs', 'participant-audio'],
  ['Workspace navigation and icons', 'workspace-navigation-smoke.cjs', 'workspace-navigation'],
]) {
  test(name, async ({}, testInfo) => {
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [path.join(root, 'scripts', script)],
        {
          cwd: root,
          env: process.env,
          timeout: 150_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      console.log(stdout);
      if (stderr) console.error(stderr);
    } finally {
      const dir = path.join(root, '.local', artifactDir);
      for (const file of await readdir(dir).catch(() => [] as string[])) {
        if (file.endsWith('.png'))
          await testInfo.attach(file, { path: path.join(dir, file), contentType: 'image/png' });
      }
    }
  });
}
