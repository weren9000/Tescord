import {Component, input, output, signal, computed, viewChild, ElementRef, effect} from '@angular/core';
import {UiIconComponent} from './ui-icon.component';
import {UploadJob, UploadEntry} from '../core/services/upload-queue.service';
import {isTextFile} from '../shared/text-files';

@Component({
  selector:'app-upload-panel', standalone:true, imports:[UiIconComponent],
  template:`
    <section class="panel" aria-label="Вложения">
      <header><button type="button" class="summary" (click)="open()"><strong>Файлы {{files().length}} / 10</strong><small>{{size(total())}} · {{summary()}}</small></button>
        <button type="button" (click)="open()">Все файлы</button>
        @if(!job()){<button type="button" aria-label="Добавить файлы" title="Добавить файлы" [disabled]="files().length>=10" (click)="add.emit()">+</button>}
      </header>
      <div class="previews">@for(file of files().slice(0,3);track file){<button type="button" class="chip" (click)="open()" [title]="file.name">
        @if(thumbnails().get(file);as url){<img [src]="url" alt=""/>}@else{<app-ui-icon name="code"/>}<span>{{file.name}}</span>
        @if(entry(file);as item){<small>{{label(item)}}</small>}
      </button>}
      @if(files().length>3){<button type="button" class="more-desktop" (click)="open()">+{{files().length-3}}</button>}
      @if(files().length>2){<button type="button" class="more-mobile" (click)="open()">+{{files().length-2}}</button>}</div>
      @if(job();as current){
        <progress [value]="loaded()" [max]="total() || 1" aria-label="Загрузка файлов"></progress>
        @if(current.status==='uploading'){<small>{{size(loaded())}} из {{size(total())}}</small>}
        @if(current.error){<p role="alert">{{current.error}}</p>}
        <div class="actions">
          @if(current.status==='failed' || current.status==='paused'){
            <button type="button" (click)="retry.emit()">Повторить отправку</button>
            @if(hasErrors() && ready()>0){<button type="button" (click)="sendReady.emit()">Отправить готовые ({{ready()}})</button>}
          }
          @if(current.status!=='finalizing' && !(current.status==='failed' && ready()===files().length)){<button type="button" (click)="cancel.emit()">{{current.status==='uploading'?'Приостановить':'Отменить отправку'}}</button>}
        </div>
      }
    </section>
    <dialog #details (click)="backdrop($event)" aria-labelledby="upload-title">
      <header><div><strong id="upload-title">Вложения · {{files().length}} / 10</strong><small>{{size(total())}} · {{summary()}}</small></div><button type="button" aria-label="Закрыть список файлов" (click)="close()"><app-ui-icon name="close"/></button></header>
      @if(hasErrors()){<label class="filter"><input type="checkbox" [checked]="errorsOnly()" (change)="errorsOnly.set($any($event.target).checked)"/> Только ошибки</label>}
      <div class="list">@for(file of files();track file){@if(!errorsOnly() || entry(file)?.status==='error'){
        <article [class.failed]="entry(file)?.status==='error'">
          @if(thumbnails().get(file);as url){<img [src]="url" alt=""/>}@else{<app-ui-icon name="code"/>}
          <div class="copy"><strong [title]="file.name">{{file.name}}</strong><small>{{size(file.size)}} @if(entry(file);as item){ · {{label(item)}}}</small>
            @if(entry(file);as item){@if(item.status==='uploading'){<progress [value]="item.loaded" [max]="file.size || 1"></progress>}@if(item.error){<p>{{item.error}}</p>}}
            @if(!job() && generated()(file)){<label>Имя файла<input [value]="file.name" maxlength="180" (change)="rename.emit({file,name:$any($event.target).value})"/></label><button type="button" (click)="restore.emit(file)">В редактор</button>}
          </div>
          @if(isTextFile(file.name)){<button type="button" aria-label="Просмотреть файл" title="Просмотреть файл" (click)="close();preview.emit(file)"><app-ui-icon name="eye"/></button>}
          @if(!job()){<button type="button" aria-label="Убрать файл" title="Убрать файл" (click)="remove.emit(file)"><app-ui-icon name="trash"/></button>}
        </article>
      }}</div>
      <footer>@if(!job()){<button type="button" [disabled]="files().length>=10" (click)="add.emit()">Добавить файлы</button>}<button type="button" (click)="close()">Готово</button></footer>
    </dialog>
  `,
  styles:[`
    :host{display:block;min-width:0}.panel{padding:10px;border:1px solid var(--palette-border);border-radius:12px;background:var(--palette-surface)}
    header,footer,.actions,.previews{display:flex;align-items:center;gap:8px;flex-wrap:wrap}header{justify-content:space-between}header>div,.summary{flex:1;min-width:0;text-align:left}.summary{border:0;background:transparent;padding:0}small{display:block;color:var(--palette-muted);font-size:12px;margin-top:3px}button{font:inherit;color:inherit;background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:9px;min-height:36px;padding:7px 10px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}
    .previews{flex-wrap:nowrap;margin-top:8px;overflow:hidden}.chip{min-width:0;max-width:30%;display:flex;align-items:center;gap:6px;flex:1}.chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.chip small{flex:none}.chip img{width:28px;height:28px;object-fit:cover;border-radius:5px}app-ui-icon{flex:none;width:20px;height:20px}
    progress{display:block;width:100%;height:5px;margin:10px 0;accent-color:var(--palette-primary)}p{font-size:12px;margin:8px 0;overflow-wrap:anywhere}.actions{margin-top:8px}.actions button{font-size:12px}
    dialog{box-sizing:border-box;width:min(620px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0;color:var(--palette-text);background:var(--palette-surface);border:1px solid var(--palette-border);border-radius:16px}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#0009;backdrop-filter:blur(3px)}dialog header,footer{padding:16px;flex-shrink:0}dialog header{border-bottom:1px solid var(--palette-border)}footer{justify-content:flex-end;border-top:1px solid var(--palette-border)}.list{overflow:auto;min-height:0;padding:8px 16px}.filter{padding:8px 16px}article{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--palette-border)}article>img{width:48px;height:48px;object-fit:cover;border-radius:8px}.copy{min-width:0;flex:1}.copy>strong{display:block;overflow-wrap:anywhere;font-size:13px}.copy label{display:block;font-size:12px}.copy input{box-sizing:border-box;width:100%;background:var(--palette-raised);color:inherit;border:1px solid var(--palette-border);border-radius:6px;padding:6px;margin:6px 0}.failed p{color:var(--palette-text)}
    .more-mobile{display:none}@media(max-width:600px){.more-mobile{display:block}.more-desktop{display:none}dialog{width:100%;height:100dvh;max-height:100dvh;max-width:100%;margin:0;border-radius:0}.chip:nth-child(n+3){display:none}.chip{max-width:none}.chip small{display:none}.previews{gap:4px}article{gap:7px}article>img{width:32px;height:32px}header>button{font-size:12px}}
  `]
})
export class UploadPanelComponent {
  readonly files=input.required<File[]>();readonly job=input<UploadJob|null>(null);readonly generated=input<(file:File)=>boolean>(()=>false);
  readonly add=output<void>();readonly remove=output<File>();readonly preview=output<File>();readonly restore=output<File>();readonly rename=output<{file:File;name:string}>();readonly retry=output<void>();readonly cancel=output<void>();readonly sendReady=output<void>();
  readonly details=viewChild<ElementRef<HTMLDialogElement>>('details');readonly errorsOnly=signal(false);readonly thumbnails=signal(new Map<File,string>());readonly isTextFile=isTextFile;
  readonly total=computed(()=>this.files().reduce((n,f)=>n+f.size,0));readonly loaded=computed(()=>this.job()?.entries.reduce((n,e)=>n+e.loaded,0)??0);readonly ready=computed(()=>this.job()?.entries.filter(e=>e.status==='ready').length??0);readonly hasErrors=computed(()=>!!this.job()?.entries.some(e=>e.status==='error'));
  readonly summary=computed(()=>{const job=this.job();return !job?'Готовы к отправке':job.status==='finalizing'?'Создаём сообщение…':job.status==='failed'?'Нужен повтор отправки':job.status==='paused'?'Приостановлено':`Готово ${this.ready()} из ${this.files().length}`;});
  constructor(){effect(onCleanup=>{const files=this.files();let stopped=false;const urls:string[]=[];this.thumbnails.set(new Map());onCleanup(()=>{stopped=true;urls.forEach(url=>URL.revokeObjectURL(url));});for(const file of files.filter(f=>/^image\/(png|jpeg|webp|gif)$/.test(f.type))){void(async()=>{try{const bitmap=await createImageBitmap(file,{resizeWidth:96,resizeHeight:96,resizeQuality:'low'});if(stopped){bitmap.close();return;}const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;canvas.getContext('2d')?.drawImage(bitmap,0,0);bitmap.close();canvas.toBlob(blob=>{if(!blob||stopped)return;const url=URL.createObjectURL(blob);urls.push(url);this.thumbnails.update(map=>new Map(map).set(file,url));},'image/webp');}catch{/* Generic file icon remains available. */}})();}});}
  entry(file:File){return this.job()?.entries.find(e=>e.file===file);}
  label(entry:UploadEntry){return entry.status==='ready'?'Готово':entry.status==='error'?'Ошибка':entry.status==='waiting'?'В очереди':`${entry.file.size?Math.floor(entry.loaded*100/entry.file.size):0}%`;}
  size(bytes:number){return bytes<1024?bytes+' Б':bytes<1024*1024?(bytes/1024).toFixed(1)+' КБ':(bytes/1024/1024).toFixed(1)+' МБ';}
  open(){this.errorsOnly.set(false);this.details()?.nativeElement.showModal();}close(){this.details()?.nativeElement.close();}backdrop(event:MouseEvent){if(event.target===this.details()?.nativeElement)this.close();}
}
