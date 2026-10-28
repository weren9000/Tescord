import {Component, OnDestroy, inject, input, output, signal, viewChild, ElementRef} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {PlatformApiService} from '../core/api/platform-api.service';
import {API_BASE_URL} from '../core/api/api-base';

@Component({selector:'app-platform-icon-editor',standalone:true,imports:[FormsModule],
 templateUrl:'./platform-icon-editor.component.html',styleUrl:'./platform-icon-editor.component.scss'})
export class PlatformIconEditorComponent implements OnDestroy {
 readonly token=input.required<string>();readonly platformId=input.required<string>();readonly current=input<string|null>(null);
 readonly changed=output<void>();readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');
 readonly mode=signal<'closed'|'upload'|'inventory'>('closed');readonly canvas=viewChild<ElementRef<HTMLCanvasElement>>('canvas');
 readonly items=signal<{id:string;catalog_id:string;name:string}[]>([]);readonly page=signal(1);readonly pages=signal(1);
 readonly chosen=signal<{id:string;catalog_id:string;name:string}|null>(null);
 x=.5;y=.5;zoom=1;private file:File|null=null;private picture:HTMLImageElement|null=null;private url='';private generation=0;
 private api=inject(PlatformApiService);private http=inject(HttpClient);
 asset(path:string|null){return path?API_BASE_URL+path:'';}
 itemUrl(id:string){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(id)+'?preview=true';}
 async load(page=1){this.mode.set('inventory');this.notice.set('');this.chosen.set(null);this.error.set('');this.busy.set(true);const generation=++this.generation;
  try{const data=await firstValueFrom(this.http.get<{items:{id:string;catalog_id:string;name:string}[];page:number;pages:number}>(API_BASE_URL+'/api/inventory?kind=avatar&page='+page,{headers:{Authorization:'Bearer '+this.token()}}));if(generation!==this.generation)return;this.items.set(data.items);this.page.set(data.page);this.pages.set(data.pages);}
  catch{if(generation===this.generation)this.error.set('Не удалось загрузить аватары. Повторите попытку.');}finally{if(generation===this.generation)this.busy.set(false);}}
 async upload(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];input.value='';if(!file)return;this.error.set('');this.notice.set('');
  if(file.size>10*1024*1024){this.error.set('Изображение должно быть не больше 10 МБ');return;}
  const generation=++this.generation;this.busy.set(true);this.file=null;this.picture=null;
  if(this.url)URL.revokeObjectURL(this.url);this.url=URL.createObjectURL(file);const picture=new Image();picture.src=this.url;
  try{await picture.decode();if(generation!==this.generation)return;if(Math.min(picture.naturalWidth,picture.naturalHeight)<128||Math.max(picture.naturalWidth,picture.naturalHeight)>4096)throw Error('Размер изображения: от 128 до 4096 пикселей');
   this.file=file;this.picture=picture;this.x=this.y=.5;this.zoom=1;this.mode.set('upload');setTimeout(()=>this.draw());
  }catch(e){if(generation===this.generation)this.error.set(e instanceof Error?e.message:'Не удалось открыть изображение');}finally{if(generation===this.generation)this.busy.set(false);}}
 draw(){const canvas=this.canvas()?.nativeElement,p=this.picture;if(!canvas||!p)return;const side=Math.min(p.naturalWidth,p.naturalHeight)/this.zoom;const ctx=canvas.getContext('2d');ctx?.clearRect(0,0,256,256);ctx?.drawImage(p,(p.naturalWidth-side)*this.x,(p.naturalHeight-side)*this.y,side,side,0,0,256,256);}
 async save(remove=false){if(this.busy())return;this.busy.set(true);this.error.set('');this.notice.set('');
  try{const path='/'+this.platformId()+'/icon';
   if(remove)await firstValueFrom(this.api.request(this.token(),'DELETE',path));
   else if(this.mode()==='inventory'&&this.chosen())await firstValueFrom(this.api.request(this.token(),'PATCH',path,{item_id:this.chosen()!.id}));
   else if(this.file){const body=new FormData();body.set('icon',this.file);body.set('crop_x',String(this.x));body.set('crop_y',String(this.y));body.set('zoom',String(this.zoom));await firstValueFrom(this.api.request(this.token(),'PUT',path,body));}else return;
   await this.api.refresh(this.token());this.changed.emit();this.mode.set('closed');this.notice.set(remove?'Иконка удалена':'Иконка сохранена');
  }catch(e:any){this.error.set(typeof e?.error?.detail==='string'?e.error.detail:'Не удалось сохранить иконку');}finally{this.busy.set(false);}}
 ngOnDestroy(){++this.generation;if(this.url)URL.revokeObjectURL(this.url);}
}
