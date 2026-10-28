import {AfterViewInit, Component, ElementRef, ViewChild, computed, effect, input, output, signal} from '@angular/core';
import {TEXT_PREVIEW_LIMIT} from '../shared/text-files';

export interface TextFileSource {name:string;size:number;load:()=>Promise<Blob>;download:()=>void;}
@Component({
  selector:'app-text-file-viewer',standalone:true,
  template:`<dialog #dialog class="text-file-viewer" aria-labelledby="text-file-title" (cancel)="dismiss($event)">
    <header><div><strong id="text-file-title">{{source().name}}</strong><small>{{source().size.toLocaleString()}} байт · Только просмотр</small></div><button type="button" aria-label="Закрыть просмотр файла" (click)="closed.emit()">✕</button></header>
    <nav aria-label="Действия с файлом">
      @if(markdown()){<button [attr.aria-pressed]="documentMode()" (click)="documentMode.set(!documentMode())">{{documentMode()?'Исходный текст':'Документ'}}</button>}
      <button [attr.aria-pressed]="wrap()" (click)="wrap.set(!wrap())">Перенос строк</button>
      <button [disabled]="loading() || !!error()" (click)="copy()">Копировать</button>
      <button (click)="source().download()">Скачать</button>
    </nav>
    @if(notice()){<p role="status">{{notice()}}</p>}
    @if(loading()){<p role="status">Загрузка файла…</p>}
    @else if(error()){<p role="alert">{{error()}}</p><button (click)="reload.update(n=>n+1)">Повторить</button>}
    @else {
      @if(truncated()){<p role="status">Показано начало файла. Полный текст доступен при скачивании.</p>}
      <div class="file-content" [class.wrap]="wrap()">
      @if(markdown() && documentMode()){<article class="document" [innerHTML]="documentHtml()"></article>}
      @else{<div class="source"><pre class="numbers" aria-hidden="true">{{numbers()}}</pre><pre class="code" tabindex="0" aria-label="Содержимое файла" [innerHTML]="codeHtml()"></pre></div>}
      </div>
    }
  </dialog>`,
  styles:[`
    .text-file-viewer{box-sizing:border-box;width:min(1000px,calc(100vw - 32px));height:min(800px,90dvh);max-width:none;max-height:100dvh;margin:auto;padding:0;border:1px solid var(--palette-border);border-radius:16px;background:var(--palette-surface);color:var(--palette-text)}
    dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#0009}header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--palette-border);gap:16px}header>div{min-width:0}strong{display:block;overflow-wrap:anywhere}small{display:block;color:var(--palette-muted);margin-top:6px}button{font:inherit;font-size:13px;color:var(--palette-text);background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:8px;padding:8px 12px;cursor:pointer}button:disabled{opacity:.5}button[aria-pressed=true]{background:var(--palette-selected)}button:focus-visible{outline:2px solid var(--palette-primary)}nav{display:flex;gap:8px;flex-wrap:wrap;padding:12px 20px}p{margin:8px 20px;font-size:13px}.file-content{flex:1;min-height:0;overflow:auto;padding:12px 20px 24px}.source{display:flex;min-width:100%;width:max-content;gap:18px}.numbers,.code{margin:0;font:13px/1.7 ui-monospace,Consolas,monospace;tab-size:4}.numbers{color:var(--palette-muted);text-align:right;user-select:none}.code{flex:1}.wrap .source{width:100%;min-width:0}.wrap .code{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}.wrap .numbers{display:none}.document{line-height:1.65;overflow-wrap:anywhere}
    :host ::ng-deep .document pre{overflow:auto;background:var(--palette-raised);padding:12px;border-radius:8px}:host ::ng-deep .document table{border-collapse:collapse;display:block;overflow:auto}:host ::ng-deep .document td,:host ::ng-deep .document th{border:1px solid var(--palette-border);padding:6px 10px}:host ::ng-deep .document a{color:var(--palette-primary)}
    :host ::ng-deep .hljs-keyword,:host ::ng-deep .hljs-title{color:var(--palette-primary)}:host ::ng-deep .hljs-string,:host ::ng-deep .hljs-attr{color:var(--palette-cyan)}:host ::ng-deep .hljs-comment{color:var(--palette-muted)}:host ::ng-deep .hljs-number,:host ::ng-deep .hljs-literal{color:var(--palette-secondary)}
    @media(max-width:980px){.text-file-viewer{width:100%;height:100dvh;border:0;border-radius:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}header{padding:12px 16px}nav{padding:10px 16px}button{min-height:44px}.file-content{padding:12px 16px}}
  `]
})
export class TextFileViewerComponent implements AfterViewInit {
  readonly source=input.required<TextFileSource>();readonly closed=output<void>();
  @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
  readonly loading=signal(true);readonly error=signal('');readonly notice=signal('');readonly content=signal('');
  readonly codeHtml=signal('');readonly documentHtml=signal('');readonly truncated=signal(false);readonly reload=signal(0);
  readonly wrap=signal(false);readonly documentMode=signal(true);readonly markdown=computed(()=>/\.(md|markdown)$/i.test(this.source().name));
  readonly numbers=computed(()=>this.content().split('\n').map((_,i)=>i+1).join('\n'));
  private opener=document.activeElement as HTMLElement|null;
  ngAfterViewInit(){this.dialog.nativeElement.showModal();}
  ngOnDestroy(){this.opener?.focus();}
  dismiss(event:Event){event.preventDefault();this.closed.emit();}
  constructor(){effect(onCleanup=>{
    const source=this.source();this.reload();let cancelled=false;onCleanup(()=>{cancelled=true;});
    this.loading.set(true);this.error.set('');this.notice.set('');
    void(async()=>{
      try{
        if(source.size>TEXT_PREVIEW_LIMIT)throw Error('Для файлов больше 1 МБ доступно скачивание.');
        const blob=await source.load();if(blob.size>TEXT_PREVIEW_LIMIT)throw Error('Файл слишком большой для просмотра. Скачайте его.');
        const text=new TextDecoder('utf-8',{fatal:true}).decode(await blob.arrayBuffer());
        if(text.includes('\0'))throw Error('Файл содержит двоичные данные. Скачайте его для открытия.');
        if(cancelled)return;
        const visible=text.slice(0,100000);this.truncated.set(visible.length<text.length);this.content.set(visible);
        const {default:hljs}=await import('highlight.js/lib/common');
        const ext=source.name.split('.').pop()?.toLowerCase()??'';
        const language=({py:'python',md:'markdown',yml:'yaml',js:'javascript',ts:'typescript',sh:'bash',html:'xml',ps1:'powershell'} as Record<string,string>)[ext]??ext;
        if(language==='powershell'){const {default:ps}=await import('highlight.js/lib/languages/powershell');hljs.registerLanguage('powershell',ps);}
        const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const code=hljs.getLanguage(language)?hljs.highlight(visible,{language,ignoreIllegals:true}).value:escape(visible);
        const {Marked}=await import('marked');
        // Raw HTML and external images never create live DOM in a document preview.
        const parser=new Marked({renderer:{html:token=>escape(token.text),image:token=>escape(token.text)}});
        const html=parser.parse(visible,{async:false});
        if(cancelled)return;this.codeHtml.set(code);this.documentHtml.set(html);
      }catch(e){if(!cancelled)this.error.set(e instanceof Error?e.message:'Не удалось открыть файл.');}
      finally{if(!cancelled)this.loading.set(false);}
    })();
  });}
  async copy(){try{const blob=await this.source().load();if(blob.size>TEXT_PREVIEW_LIMIT)throw Error();await navigator.clipboard.writeText(await blob.text());this.notice.set('Содержимое скопировано');}catch{this.notice.set('Не удалось скопировать. Попробуйте скачать файл.');}}
}
