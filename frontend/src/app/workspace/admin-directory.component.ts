import {Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, input, output, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {Subscription} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';

type Tab = 'users' | 'groups' | 'platforms';
interface Entry {
  id: string; name: string; public_id?: number; email?: string; created_at: string;
  is_admin?: boolean; is_avatar_admin?: boolean; avatar_updated_at?: string;
  owner_id?: string; owner_name?: string; members_count?: number; channels_count?: number;
  icon_asset?: string; icon_url?: string; icon_updated_at?: string; description?: string; kind?: string; role?: string; type?: string;
}
interface Page {items: Entry[]; total: number; page: number; pages: number}
interface Filter {q: string; owner: string; role: string; sort: string; page: number; size: number; scroll: number}
const emptyPage = (): Page => ({items: [], total: 0, page: 1, pages: 1});

@Component({selector:'app-admin-directory', standalone:true, imports:[CommonModule, FormsModule],
  templateUrl:'./admin-directory.component.html', styleUrl:'./admin-directory.component.scss'})
export class AdminDirectoryComponent implements OnInit, OnDestroy {
  readonly token = input.required<string>();
  readonly close = output<void>();
  readonly forbidden = output<void>();
  readonly tabs: {id:Tab;label:string}[] = [{id:'users',label:'Пользователи'},{id:'groups',label:'Группы'},{id:'platforms',label:'Площадки'}];
  readonly tab = signal<Tab>('users');
  readonly counts = signal<Record<Tab, number>|null>(null);
  readonly result = signal<Page>(emptyPage());
  readonly loading = signal(false);
  readonly error = signal('');
  readonly detail = signal<Entry|null>(null);
  readonly detailKind = signal<Tab>('users');
  readonly detailOpen = signal(false);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  readonly related = signal<Page>(emptyPage());
  readonly relation = signal<'spaces'|'members'|'channels'>('spaces');
  readonly relatedLoading = signal(false);
  readonly relatedError = signal('');
  readonly copied = signal('');
  readonly failedImages = signal<Set<string>>(new Set());
  memberSearch = '';
  private readonly http = inject(HttpClient);
  private listSub?: Subscription;
  private detailSub?: Subscription;
  private relatedSub?: Subscription;
  private countSub?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  private focusTimer?: ReturnType<typeof setTimeout>;
  private opener?: HTMLElement;
  private detailKey = '';
  private readonly filters: Record<Tab,Filter> = Object.fromEntries(['users','groups','platforms'].map(k=>[k,{q:'',owner:'',role:'all',sort:'new',page:1,size:24,scroll:0}])) as Record<Tab,Filter>;
  @ViewChild('list') list?: ElementRef<HTMLElement>;
  get filter(){return this.filters[this.tab()];}
  ngOnInit(){this.refresh();}
  ngOnDestroy(){this.listSub?.unsubscribe();this.detailSub?.unsubscribe();this.relatedSub?.unsubscribe();this.countSub?.unsubscribe();clearTimeout(this.timer);clearTimeout(this.focusTimer);}
  private get<T>(path:string, params:Record<string,string|number>={}){return this.http.get<T>(API_BASE_URL+'/api/admin/directory'+path,{params,headers:{Authorization:'Bearer '+this.token()}});}
  private message(e:unknown){if(e instanceof HttpErrorResponse && (e.status===403 || e.status===401)){this.forbidden.emit();return 'Доступ к админке закрыт.';}return e instanceof HttpErrorResponse && e.status===404?'Запись больше недоступна.':'Не удалось загрузить данные. Повторите попытку.';}
  refresh(){this.countSub?.unsubscribe();this.countSub=this.get<Record<Tab,number>>('/counts').subscribe({next:x=>this.counts.set(x),error:e=>this.message(e)});this.load();}
  switchTab(tab:Tab){if(tab===this.tab())return;this.filter.scroll=this.list?.nativeElement.scrollTop??0;clearTimeout(this.timer);this.closeDetail();this.tab.set(tab);this.load(true);}
  search(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.change(),300);}
  change(){clearTimeout(this.timer);this.filter.page=1;this.filter.scroll=0;this.load();}
  reset(){Object.assign(this.filter,{q:'',owner:'',role:'all',sort:'new',page:1,scroll:0});this.load();}
  go(page:number){this.filter.page=page;this.filter.scroll=0;this.load();}
  load(restore=false){
    this.listSub?.unsubscribe();this.loading.set(true);this.error.set('');
    const f=this.filter, tab=this.tab();
    const params:Record<string,string|number>={q:f.q,sort:f.sort,page:f.page,size:f.size};
    if(tab==='users')params['role']=f.role;else params['owner']=f.owner;
    this.listSub=this.get<Page>(tab==='users'?'/users':'/spaces/'+tab,params).subscribe({next:data=>{
      this.result.set(data);f.page=data.page;this.loading.set(false);
      clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>{if(this.list)this.list.nativeElement.scrollTop=restore?f.scroll:0;});
    },error:e=>{this.error.set(this.message(e));this.loading.set(false);}});
  }
  open(row:Entry,kind:Tab=this.tab()){
    this.opener=document.activeElement as HTMLElement;this.detailKey=row.id;this.detailKind.set(kind);this.detailOpen.set(true);
    this.detail.set(null);this.detailLoading.set(true);this.detailError.set('');this.copied.set('');this.memberSearch='';
    this.relatedSub?.unsubscribe();this.related.set(emptyPage());this.relatedError.set('');this.detailSub?.unsubscribe();
    this.relation.set(kind==='users'?'spaces':'members');
    this.detailSub=this.get<Entry>(this.detailPath()).subscribe({next:data=>{this.detail.set(data);this.detailLoading.set(false);this.loadRelated();},error:e=>{this.detailError.set(this.message(e));this.detailLoading.set(false);}});
    clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>document.querySelector<HTMLButtonElement>('app-admin-directory .detail-close')?.focus());
  }
  retryDetail(){this.open({id:this.detailKey,name:'',created_at:''},this.detailKind());}
  closeDetail(){this.detailSub?.unsubscribe();this.relatedSub?.unsubscribe();this.detailOpen.set(false);if(this.opener?.isConnected)this.opener.focus({preventScroll:true});}
  private detailPath(){return this.detailKind()==='users'?'/users/'+this.detailKey:'/spaces/'+this.detailKind()+'/'+this.detailKey;}
  loadRelated(page=1){
    this.relatedSub?.unsubscribe();this.relatedLoading.set(true);this.relatedError.set('');
    this.relatedSub=this.get<Page>(this.detailPath()+'/'+this.relation(),{page,q:this.memberSearch}).subscribe({next:x=>{this.related.set(x);this.relatedLoading.set(false);},error:e=>{this.relatedError.set(this.message(e));this.relatedLoading.set(false);}});
  }
  changeRelation(value:'members'|'channels'){this.relation.set(value);this.memberSearch='';this.loadRelated();}
  openRelated(row:Entry){this.open(row,this.relation()==='spaces'?(row.kind==='workspace'?'platforms':'groups'):'users');}
  openOwner(){const d=this.detail();if(d?.owner_id)this.open({id:d.owner_id,name:d.owner_name??'',created_at:''},'users');}
  roles(row:Entry){return [row.is_admin?'Администратор':'',row.is_avatar_admin?'Админ аватарок':''].filter(Boolean).join(' · ')||'Пользователь';}
  memberRole(role?:string){return ({owner:'Владелец',admin:'Администратор',member:'Участник'} as Record<string,string>)[role??'']??'';}
  kindLabel(kind?:string){return kind==='workspace'?'Площадка':'Группа';}
  image(row:Entry,kind:Tab){if(kind==='users')return API_BASE_URL+'/api/users/'+row.id+'/avatar?preview=true&v='+encodeURIComponent(row.avatar_updated_at??'');if(row.icon_updated_at)return API_BASE_URL+'/api/servers/'+row.id+'/icon-file?preview=true&v='+encodeURIComponent(row.icon_updated_at);return row.icon_url??'';}
  imageFailed(url:string){this.failedImages.update(old=>new Set([...old,url]));}
  async copy(value:string){try{await navigator.clipboard.writeText(value);this.copied.set('Скопировано');}catch{this.copied.set('Не удалось скопировать. Выделите ID вручную.');}}
  keydown(event:KeyboardEvent){if(event.key==='Escape' && this.detailOpen()){event.stopPropagation();this.closeDetail();}}
}
