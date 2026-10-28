import {AfterViewInit,Component,ElementRef,ViewChild,computed,effect,inject,input,output,signal,untracked} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {API_BASE_URL} from '../core/api/api-base';
import {WorkspaceMessageAttachment} from '../core/models/workspace.models';
import {PhotoThumbnailComponent} from './photo-thumbnail.component';
import {UiIconComponent} from './ui-icon.component';

@Component({selector:'app-photo-viewer',standalone:true,imports:[PhotoThumbnailComponent,UiIconComponent],template:`
  <dialog #dialog aria-label="Просмотр фотографии" (cancel)="dismiss($event)" (keydown)="key($event)">
    <header><div><strong>{{photo().filename}}</strong><small>{{index()+1}} / {{photos().length}} · {{size(photo().size_bytes)}}</small></div>
      <button type="button" aria-label="Скачать оригинал" title="Скачать оригинал" (click)="download.emit(photo())"><app-ui-icon name="download"/></button>
      @if(deletable()){<button type="button" aria-label="Удалить фото" title="Удалить фото" (click)="remove.emit(photo())"><app-ui-icon name="trash"/></button>}
      <button type="button" autofocus aria-label="Закрыть просмотр фотографии" title="Закрыть" (click)="closed.emit()"><app-ui-icon name="close"/></button>
    </header>
    <div #stage class="stage" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="cancelPointer($event)" (wheel)="wheel($event)" (dblclick)="zoom(scale()===1?2:1)">
      <div class="preview" [style.visibility]="loaded()?'hidden':'visible'"><app-photo-thumbnail [id]="photo().id" [token]="token()" [name]="photo().filename"/></div>
      @if(url();as src){<img class="original" [src]="src" [alt]="photo().filename" draggable="false" [style.transform]="transform()" (load)="loaded.set(true)" (error)="error.set('Не удалось отобразить оригинал');loaded.set(false)" [style.visibility]="loaded()?'visible':'hidden'"/>}
      @if(!loaded() && !error()){<span class="status" role="status">Загружаем оригинал…</span>}
      @if(error()){<div class="status" role="alert">{{error()}} <button type="button" (click)="reload.update(n=>n+1)">Повторить</button></div>}
    </div>
    <footer>
      <button type="button" aria-label="Предыдущее фото" [disabled]="index()===0" (click)="step(-1)">←</button>
      <button type="button" aria-label="Уменьшить фото" [disabled]="scale()===1 || !loaded()" (click)="zoom(scale()/1.5)">−</button>
      <button type="button" aria-label="Вписать фото в экран" [disabled]="!loaded()" (click)="zoom(1)">{{Math.round(scale()*100)}}%</button>
      <button type="button" aria-label="Увеличить фото" [disabled]="scale()===6 || !loaded()" (click)="zoom(scale()*1.5)">+</button>
      <button type="button" aria-label="Следующее фото" [disabled]="index()===photos().length-1" (click)="step(1)">→</button>
    </footer>
  </dialog>
`,styles:[`
 dialog{position:fixed;inset:0;box-sizing:border-box;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;color:var(--palette-text);background:var(--palette-canvas)}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#000c}header,footer{display:flex;align-items:center;gap:8px;padding:12px;flex:none;background:var(--palette-surface)}header>div{flex:1;min-width:0}strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}small{display:block;color:var(--palette-muted);font-size:12px;margin-top:4px}button{min-width:42px;min-height:42px;display:grid;place-items:center;padding:8px;border:1px solid var(--palette-border);border-radius:10px;background:var(--palette-raised);color:inherit;font:inherit;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid var(--palette-primary)}app-ui-icon{width:20px;height:20px}footer{justify-content:center;padding-bottom:max(12px,env(safe-area-inset-bottom))}.stage{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;user-select:none;background:#08090c}.preview{position:absolute;inset:0}.preview app-photo-thumbnail{background:#08090c}.original{position:relative;max-width:100%;max-height:100%;object-fit:contain;z-index:1;user-select:none;pointer-events:none}.status{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);max-width:calc(100% - 32px);box-sizing:border-box;background:#111d;color:white;border-radius:8px;padding:10px 14px;z-index:2;text-align:center;font-size:13px}.status button{display:inline-grid;margin-left:8px}@media(max-width:600px){header{padding:8px;gap:5px}header button{min-width:40px;min-height:40px}strong{font-size:12px}}
`]})
export class PhotoViewerComponent implements AfterViewInit {
  readonly photos=input.required<WorkspaceMessageAttachment[]>();readonly selectedId=input.required<string>();readonly token=input.required<string>();readonly deletable=input(false);
  readonly choose=output<string>();readonly closed=output<void>();readonly download=output<WorkspaceMessageAttachment>();readonly remove=output<WorkspaceMessageAttachment>();
  @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;@ViewChild('stage') stage!:ElementRef<HTMLElement>;
  readonly index=computed(()=>Math.max(0,this.photos().findIndex(p=>p.id===this.selectedId())));readonly photo=computed(()=>this.photos()[this.index()],{equal:(a,b)=>a?.id===b?.id});readonly url=signal<string|null>(null);readonly loaded=signal(false);readonly error=signal('');readonly reload=signal(0);readonly scale=signal(1);readonly x=signal(0);readonly y=signal(0);readonly Math=Math;
  readonly transform=computed(()=>`translate(${this.x()}px,${this.y()}px) scale(${this.scale()})`);
  private readonly http=inject(HttpClient);private pointers=new Map<number,{x:number;y:number}>();private startX=0;private startY=0;private pinched=false;
  constructor(){effect(cleanup=>{const photo=this.photo(),token=this.token();this.reload();let objectUrl:string|null=null;this.url.set(null);this.loaded.set(false);this.error.set('');untracked(()=>{this.zoom(1);this.pointers.clear();});
    const request=this.http.get(`${API_BASE_URL}/api/attachments/${photo.id}`,{headers:new HttpHeaders({Authorization:'Bearer '+token}),responseType:'blob'}).subscribe({next:blob=>{objectUrl=URL.createObjectURL(blob);this.url.set(objectUrl);},error:()=>this.error.set('Не удалось загрузить оригинал. Проверьте соединение.')});
    cleanup(()=>{request.unsubscribe();if(objectUrl)URL.revokeObjectURL(objectUrl);});
  });}
  ngAfterViewInit(){this.dialog.nativeElement.showModal();}
  dismiss(event:Event){event.preventDefault();this.closed.emit();}
  step(delta:number){const photo=this.photos()[this.index()+delta];if(photo)this.choose.emit(photo.id);}
  key(event:KeyboardEvent){if(event.key==='ArrowLeft'){event.preventDefault();this.step(-1);}if(event.key==='ArrowRight'){event.preventDefault();this.step(1);}}
  size(bytes:number){return (bytes/1024/1024).toFixed(1)+' МБ';}
  zoom(scale:number){this.scale.set(Math.max(1,Math.min(6,scale)));if(this.scale()===1){this.x.set(0);this.y.set(0);}this.constrain();}
  private constrain(){const rect=this.stage?.nativeElement.getBoundingClientRect(),img=this.stage?.nativeElement.querySelector<HTMLImageElement>('.original');if(!rect||!img)return;const maxX=Math.max(0,(img.clientWidth*this.scale()-rect.width)/2),maxY=Math.max(0,(img.clientHeight*this.scale()-rect.height)/2);this.x.update(x=>Math.max(-maxX,Math.min(maxX,x)));this.y.update(y=>Math.max(-maxY,Math.min(maxY,y)));}
  wheel(event:WheelEvent){event.preventDefault();if(this.loaded())this.zoom(this.scale()*(event.deltaY<0?1.15:1/1.15));}
  down(event:PointerEvent){if((event.target as HTMLElement).closest('button'))return;this.stage.nativeElement.setPointerCapture(event.pointerId);this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(this.pointers.size===1){this.startX=event.clientX;this.startY=event.clientY;this.pinched=false;}else this.pinched=true;}
  move(event:PointerEvent){const previous=this.pointers.get(event.pointerId);if(!previous)return;const before=[...this.pointers.values()];this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(this.pointers.size===2 && this.loaded()){const after=[...this.pointers.values()];const distance=(p:{x:number;y:number}[])=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);const old=distance(before);if(old>0)this.zoom(this.scale()*distance(after)/old);}else if(this.scale()>1){this.x.update(x=>x+event.clientX-previous.x);this.y.update(y=>y+event.clientY-previous.y);this.constrain();}}
  up(event:PointerEvent){if(!this.pointers.has(event.pointerId))return;this.pointers.delete(event.pointerId);if(!this.pointers.size && !this.pinched && this.scale()===1 && event.pointerType==='touch'){const dx=event.clientX-this.startX,dy=event.clientY-this.startY;if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5)this.step(dx<0?1:-1);}}
  cancelPointer(event:PointerEvent){this.pointers.delete(event.pointerId);this.pinched=true;}
}
