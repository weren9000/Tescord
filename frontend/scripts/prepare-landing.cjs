// Keep the public HTML readable without JavaScript, using the same content as Angular.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src/app/landing/landing.component.html'),'utf8');
const css=fs.readFileSync(path.join(root,'src/app/landing/landing.component.css'),'utf8');
const index=path.join(root,'src/index.html');
let source=fs.readFileSync(index,'utf8');
source=source.replace(/<app-root>[\s\S]*?<\/app-root>/,`<app-root><style>${css}</style>${html}</app-root>`);
fs.writeFileSync(index,source);
