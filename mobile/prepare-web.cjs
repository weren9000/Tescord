const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const source = path.resolve(root, '../frontend/dist/frontend/browser');
const destination = path.join(root, 'web');
if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Build frontend first');
fs.rmSync(destination, {recursive:true, force:true});
fs.cpSync(source, destination, {recursive:true, filter: file => path.relative(source,file).split(path.sep)[0] !== 'downloads'});
fs.copyFileSync(path.join(root, 'bootstrap.js'), path.join(destination, 'android-bootstrap.js'));
fs.writeFileSync(path.join(destination, 'runtime-config.js'), 'window.__TESCORD_RUNTIME_CONFIG__={apiBaseUrl:"https://kvachat.ru",wsBaseUrl:"wss://kvachat.ru",sfuUrl:"wss://kvachat.ru/livekit"};');
const index = path.join(destination, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index,'utf8').replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="frame-src \'none\'; object-src \'none\'; base-uri \'self\'"><script src="android-bootstrap.js"></script>'));
// Let Capacitor keep content inside system bars; the web layout handles keyboard resizing.
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('viewport-fit=cover, ', ''));
