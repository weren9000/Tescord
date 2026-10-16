import {DestroyRef, Injectable, inject, signal} from '@angular/core';

interface InstallPrompt extends Event {
  prompt():Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}
@Injectable({providedIn:'root'})
export class PwaInstallService {
  readonly installed=signal(window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & {standalone?:boolean}).standalone);
  readonly helpOpen=signal(false);
  readonly busy=signal(false);
  private deferred:InstallPrompt|null=null;
  constructor(){
    const capture=(event:Event)=>{event.preventDefault();this.deferred=event as InstallPrompt;};
    const installed=()=>{this.installed.set(true);this.helpOpen.set(false);this.deferred=null;};
    window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',installed);
    inject(DestroyRef).onDestroy(()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',installed);});
    // Reuse the notification worker; do not create a competing scope or cache private chat data.
    if(!window.kvaDesktop && 'serviceWorker' in navigator && window.isSecureContext)void navigator.serviceWorker.register('/push-sw.js').catch(()=>{});
  }
  async open(){
    if(this.busy())return;
    const prompt=this.deferred;
    if(!prompt){this.helpOpen.set(true);return;}
    this.busy.set(true);
    try{await prompt.prompt();await prompt.userChoice;}catch{this.helpOpen.set(true);}
    finally{this.deferred=null;this.busy.set(false);}
  }
}
