import {app, BrowserWindow, Menu, Tray, nativeImage, session, net, ipcMain, safeStorage, shell, dialog, screen, desktopCapturer, powerSaveBlocker} from 'electron';
import type {DesktopCapturerSource, IpcMainEvent} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ORIGIN = 'https://kvachat.ru';
const root = path.resolve(__dirname, '..');
const web = path.join(root, 'web');
const developmentTest = !app.isPackaged && process.env.KVA_DESKTOP_TEST === '1';
if (developmentTest && process.env.KVA_DESKTOP_PROFILE) app.setPath('userData', process.env.KVA_DESKTOP_PROFILE);
app.setAppUserModelId('ru.kvachat.desktop');
let main: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let picker: BrowserWindow | null = null;
let captureSources: DesktopCapturerSource[] = [];
let finishCapture: ((id?: string, audio?: boolean) => void) | null = null;
let audioBlocker: number | null = null;
const trusted = (url: string) => { try {const origin=new URL(url).origin;return origin === ORIGIN || (developmentTest && origin === 'http://localhost:4200');} catch {return false;} };
const isMain = (event: IpcMainEvent) => !!main && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame && trusted(event.senderFrame.url);
const isPicker = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!picker && event.sender === picker.webContents && event.senderFrame === picker.webContents.mainFrame;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');

function readState(): {width?:number;height?:number;x?:number;y?:number;maximized?:boolean} {
  try {return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));} catch {return {};}
}
function saveState() {
  if (!main || main.isDestroyed() || main.isMinimized()) return;
  try {fs.writeFileSync(stateFile(), JSON.stringify({...main.getNormalBounds(), maximized:main.isMaximized()}));} catch {}
}
function showWindow() {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
}
function external(url: string) {
  try {const parsed = new URL(url); if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) void shell.openExternal(url);} catch {}
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {quitting = true; saveState(); finishCapture?.();});
  app.on('window-all-closed', () => {if (quitting) app.quit();});
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const appSession = session.defaultSession;
    // Serve the bundled UI at its real HTTPS origin; API/media requests retain
    // normal TLS validation and existing server CORS/WebSocket rules.
    appSession.protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.origin === ORIGIN && request.method === 'GET') {
        let pathname: string;
        try {pathname = decodeURIComponent(url.pathname);} catch {return new Response('', {status:400});}
        const candidate = path.resolve(web, '.' + pathname);
        const inside = candidate.startsWith(web + path.sep);
        if (inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return net.fetch(pathToFileURL(candidate).toString());
        }
        if (pathname === '/' || pathname.startsWith('/invite/')) {
          const html = fs.readFileSync(path.join(web, 'index.html'));
          return new Response(html, {headers:{'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https: wss:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'"}});
        }
      }
      return net.fetch(request, {bypassCustomProtocolHandlers:true});
    });
    appSession.setPermissionCheckHandler((contents, permission, origin) => !!main && contents === main.webContents && trusted(origin) && ['media','notifications','fullscreen','display-capture'].includes(permission));
    const granted = new Set<string>();
    appSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (!main || contents !== main.webContents || !trusted(details.requestingUrl) || !['media','notifications','fullscreen','display-capture'].includes(permission)) {callback(false); return;}
      if (permission === 'fullscreen' || permission === 'display-capture' || granted.has(permission) || developmentTest) {callback(true);return;}
      const answer = await dialog.showMessageBox(main, {type:'question',title:'Квачат — разрешение',message:permission==='media'?'Разрешить доступ к микрофону и камере?':'Разрешить уведомления Квачат?',buttons:['Разрешить','Отмена'],defaultId:0,cancelId:1});
      if (answer.response===0) granted.add(permission);
      callback(answer.response===0);
    });

    ipcMain.on('session:read', event => {
      let value: string | null=null;
      try {if (isMain(event) && safeStorage.isEncryptionAvailable() && fs.existsSync(sessionFile())) value = safeStorage.decryptString(fs.readFileSync(sessionFile()));} catch {}
      event.returnValue=value;
    });
    ipcMain.on('session:write', (event, value: unknown) => {
      let success=false;
      try {
        if (!isMain(event)) return;
        if (value === null) {fs.rmSync(sessionFile(),{force:true}); success=true;return;}
        if (typeof value!=='string' || value.length>1024*1024 || !safeStorage.isEncryptionAvailable()) return;
        const parsed=JSON.parse(value);
        if (typeof parsed.access_token!=='string' || !parsed.user) return;
        const temp=sessionFile()+'.tmp';
        fs.writeFileSync(temp,safeStorage.encryptString(value));fs.renameSync(temp,sessionFile());success=true;
      } catch {} finally {event.returnValue=success;}
    });

    ipcMain.handle('capture:sources', event => isPicker(event) ? captureSources.map(source=>({id:source.id,name:source.name,thumbnail:source.thumbnail.toDataURL()})) : []);
    ipcMain.on('capture:choose', (event,id:unknown,audio:unknown) => {if(isPicker(event) && typeof id==='string') finishCapture?.(id,audio===true);});
    ipcMain.on('capture:cancel', event=>{if(isPicker(event)) finishCapture?.();});
    appSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!main || request.frame !== main.webContents.mainFrame || !trusted(request.securityOrigin) || picker) {callback(null);return;}
      try {
        captureSources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:320,height:180},fetchWindowIcons:false});
        if (main.isDestroyed()) {callback(null);return;}
        captureSources=captureSources.filter(source=>!source.name.startsWith('Демонстрация экрана — Квачат'));
        picker=new BrowserWindow({width:800,height:620,minWidth:520,minHeight:400,parent:main,modal:false,title:'Демонстрация экрана — Квачат',autoHideMenuBar:true,backgroundColor:'#111a35',webPreferences:{preload:path.join(__dirname,'picker-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
        let completed=false;
        const timeout=setTimeout(()=>finishCapture?.(),120000);
        finishCapture=(id,audio)=>{
          if(completed)return;completed=true;clearTimeout(timeout);
          const source=captureSources.find(item=>item.id===id);
          const old=picker;picker=null;finishCapture=null;captureSources=[];if(old&&!old.isDestroyed())setImmediate(()=>old.destroy());
          callback(source?{video:source,...(audio && request.audioRequested?{audio:'loopback' as const}:{})}:null);
        };
        picker.on('closed',()=>finishCapture?.());
        picker.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        picker.webContents.on('will-navigate',event=>event.preventDefault());
        await picker.loadFile(path.join(root,'ui/picker.html'));
      } catch {if(finishCapture)finishCapture();else callback(null);}
    });

    const state=readState();
    const width=Number.isFinite(state.width)?Math.max(800,Math.min(3840,state.width!)):1360;
    const height=Number.isFinite(state.height)?Math.max(600,Math.min(2160,state.height!)):900;
    const position=Number.isFinite(state.x)&&Number.isFinite(state.y)&&screen.getAllDisplays().some(d=>state.x!+100>d.workArea.x&&state.x!<d.workArea.x+d.workArea.width&&state.y!+50>d.workArea.y&&state.y!<d.workArea.y+d.workArea.height)?{x:state.x,y:state.y}:{};
    main=new BrowserWindow({width,height,...position,minWidth:800,minHeight:600,show:false,title:'Квачат',autoHideMenuBar:true,backgroundColor:'#101832',icon:path.join(web,'assets/Icons.png'),webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,spellcheck:true}});
    main.webContents.on('page-title-updated',event=>event.preventDefault());
    main.on('ready-to-show',()=>{if(state.maximized)main!.maximize();main!.show();});
    main.on('resize',saveState);main.on('move',saveState);
    main.on('close',event=>{saveState();if(!quitting && tray){event.preventDefault();main!.hide();}});
    main.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
    main.webContents.on('will-navigate',(event,url)=>{if(!trusted(url)){event.preventDefault();external(url);}});
    main.webContents.on('will-attach-webview',event=>event.preventDefault());
    main.webContents.on('audio-state-changed',()=>{
      const audible=main?.webContents.isCurrentlyAudible();
      if(audible&&audioBlocker===null)audioBlocker=powerSaveBlocker.start('prevent-app-suspension');
      if(!audible&&audioBlocker!==null){powerSaveBlocker.stop(audioBlocker);audioBlocker=null;}
    });
    main.webContents.on('render-process-gone',()=>{if(main&&!quitting)void dialog.showMessageBox(main,{type:'error',message:'Окно Квачат было остановлено. Перезапустить интерфейс?',buttons:['Перезапустить','Закрыть'],cancelId:1}).then(answer=>{if(answer.response===0)main?.reload();else{quitting=true;app.quit();}});});
    const icon=nativeImage.createFromPath(path.join(web,'assets/Icons.png')).resize({width:32,height:32});
    tray=new Tray(icon);tray.setToolTip('Квачат');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Квачат',click:showWindow},{label:'О приложении',click:()=>{if(main)void dialog.showMessageBox(main,{title:'Квачат',message:`Квачат ${app.getVersion()}`,detail:'Тестовая версия для Windows 10/11. Закрытие окна сворачивает приложение в трей. Для завершения используйте «Выйти».'});}},{type:'separator'},{label:'Выйти',click:()=>{quitting=true;app.quit();}}]));
    tray.on('double-click',showWindow);
    const testUrl=developmentTest?process.env.KVA_DESKTOP_TEST_URL:undefined;
    if(testUrl) {
      // Development-only integration tests against the local Angular/backend pair.
      if(new URL(testUrl).origin!=='http://localhost:4200')throw new Error('Only the local Angular test endpoint is allowed');
      await main.loadURL(testUrl);
    } else await main.loadURL(ORIGIN+'/');
  }).catch(error=>{dialog.showErrorBox('Не удалось запустить Квачат',String(error));app.quit();});
}
