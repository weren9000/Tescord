const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, '../frontend/dist/frontend/browser');
if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Build frontend first: npm run build --prefix ../frontend');
const target = path.join(root, 'web');
fs.rmSync(target, {recursive: true, force: true});
fs.cpSync(source, target, {recursive: true, filter: file => path.relative(source,file).split(path.sep)[0] !== 'downloads'});
fs.writeFileSync(path.join(target, 'runtime-config.js'), 'window.__TESCORD_RUNTIME_CONFIG__ = {apiBaseUrl:"https://kvachat.ru",wsBaseUrl:"wss://kvachat.ru",sfuUrl:"wss://kvachat.ru/livekit"};\n');
