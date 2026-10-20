import {Injectable} from '@angular/core';
import {CATALOG_PREVIEW_VERSION} from './catalog-preview-version';

/** Public catalogue thumbnails only. Never stores profiles, chat media or API JSON. */
@Injectable({providedIn:'root'})
export class CatalogImagesService {
 private readonly pending=new Map<string,Promise<Blob>>();
 private active=0;
 private readonly waiting:Array<()=>void>=[];
 private manifest?:Promise<Record<string,string>>;
 private writes:Promise<void>=Promise.resolve();
 private async slot(){
  if(this.active>=4)await new Promise<void>(resolve=>this.waiting.push(resolve));
  else this.active++;
 }
 private release(){const next=this.waiting.shift();if(next)next();else this.active--;}
 private async download(url:string|URL){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{return await fetch(url,{credentials:'omit',signal:controller.signal});}finally{clearTimeout(timer);}
 }
 load(src:string):Promise<Blob>{
  const existing=this.pending.get(src);if(existing)return existing;
  const task=this.read(src).finally(()=>this.pending.delete(src));
  this.pending.set(src,task);return task;
 }
 private async read(src:string){
  await this.slot();
  try{
   if(document.hidden)await new Promise<void>(resolve=>{
    const resume=()=>{if(!document.hidden){document.removeEventListener('visibilitychange',resume);resolve();}};
    document.addEventListener('visibilitychange',resume);
   });
   const url=new URL(src,location.href);
   const match=url.pathname.match(/^\/api\/inventory\/assets\/([a-zA-Z0-9-]+)$/);
   const thumbnail=!!match&&url.searchParams.get('preview')==='true';
   let target=src;
   if(thumbnail){
    this.manifest??=this.download(new URL('assets/catalog-previews/manifest.json?v='+CATALOG_PREVIEW_VERSION,document.baseURI))
      .then(r=>r.ok?r.json():{}).catch(()=>({}));
    const local=(await this.manifest)[match![1]];
    if(local)target=new URL('assets/catalog-previews/'+local,document.baseURI).href;
   }
   let cache:Cache|undefined;let saved:Response|undefined;
   if(thumbnail&&'caches' in window){
    try{
     cache=await caches.open('kva-catalog-thumbnails-v1');
     saved=await cache.match(target);
     if(saved&&Date.now()-Number(saved.headers.get('x-kva-stored'))<3600000)return saved.blob();
    }catch{/* HTTP cache remains available in restricted WebViews. */}
   }
   let response:Response;
   try{
    response=await this.download(target);
    if(!response.ok&&target!==src)response=await this.download(src);
   }catch(error){if(saved)return saved.blob();if(target!==src)response=await this.download(src);else throw error;}
   if(!response.ok)throw new Error('Image unavailable');
   const blob=await response.blob();
   if(!blob.type.startsWith('image/'))throw new Error('Invalid image');
   if(cache&&blob.size<=256*1024){
    const store=cache;
    this.writes=this.writes.catch(()=>{}).then(async()=>{
     await store.delete(target);
     await store.put(target,new Response(blob,{headers:{'Content-Type':blob.type,'x-kva-stored':String(Date.now())}}));
     const keys=await store.keys();
     await Promise.all(keys.slice(0,Math.max(0,keys.length-160)).map(key=>store.delete(key)));
    });
    void this.writes.catch(()=>{});
   }
   return blob;
  }finally{this.release();}
 }
}
