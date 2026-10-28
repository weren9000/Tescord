import {Component, ElementRef, effect, inject, input, signal} from '@angular/core';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {API_BASE_URL} from '../core/api/api-base';
import {Subscription} from 'rxjs';

@Component({selector:'app-photo-thumbnail',standalone:true,template:`
  @if(url();as src){<img [src]="src" [alt]="name()" [class.cover]="crop()" draggable="false"/>}
  @else if(failed()){<span class="fallback">Превью недоступно<br><small>Открыть оригинал</small></span>}
  @else{<span class="skeleton" aria-label="Загрузка превью"></span>}
`,styles:[`
 :host{display:block;width:100%;height:100%;overflow:hidden;background:var(--palette-canvas)}img{display:block;width:100%;height:100%;object-fit:contain}.cover{object-fit:cover}.skeleton{display:block;width:100%;height:100%;background:linear-gradient(100deg,var(--palette-surface) 25%,var(--palette-raised) 45%,var(--palette-surface) 65%);background-size:200% 100%;animation:shimmer 1.5s infinite}.fallback{display:grid;place-content:center;height:100%;padding:8px;box-sizing:border-box;text-align:center;font-size:12px;color:var(--palette-muted)}small{margin-top:6px}@keyframes shimmer{to{background-position:-200% 0}}@media(prefers-reduced-motion:reduce){.skeleton{animation:none}}
`]})
export class PhotoThumbnailComponent {
  readonly id=input.required<string>();readonly token=input.required<string>();readonly name=input('Фотография');readonly crop=input(false);
  readonly url=signal<string|null>(null);readonly failed=signal(false);
  private readonly http=inject(HttpClient);private readonly host=inject(ElementRef<HTMLElement>);
  constructor(){effect(cleanup=>{const id=this.id(),token=this.token();let objectUrl:string|null=null;let request:Subscription|undefined;this.url.set(null);this.failed.set(false);
    const observer=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting)||!token)return;observer.disconnect();request=this.http.get(`${API_BASE_URL}/api/attachments/${id}/preview`,{headers:new HttpHeaders({Authorization:'Bearer '+token}),responseType:'blob'}).subscribe({next:blob=>{objectUrl=URL.createObjectURL(blob);this.url.set(objectUrl);},error:()=>this.failed.set(true)});},{rootMargin:'160px'});
    observer.observe(this.host.nativeElement);cleanup(()=>{observer.disconnect();request?.unsubscribe();if(objectUrl)URL.revokeObjectURL(objectUrl);});
  });}
}
