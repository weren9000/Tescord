import { AfterViewInit, Component, ElementRef, ViewChild, input, output, signal } from '@angular/core';

export interface QuickLink { id: string; label: string; detail: string; spaceId: string; channelId?: string; userPublicId?: number; }
@Component({
  selector:'app-quick-switch',standalone:true,
  template:`<div class="backdrop" (click)="close.emit()"><section role="dialog" aria-modal="true" aria-label="Быстрый переход" (click)="$event.stopPropagation()" (keydown)="onKey($event)">
    <header><input #queryInput role="combobox" aria-label="Найти беседу или канал" aria-expanded="true" aria-controls="quick-results" [attr.aria-activedescendant]="links().length ? 'quick-link-' + active() : null" placeholder="Куда перейдём?" [value]="query()" (input)="active.set(0); search.emit($any($event.target).value)"/><button aria-label="Закрыть быстрый переход" (click)="close.emit()">Esc</button></header>
    <div id="quick-results" role="listbox">@for(link of links(); track link.id; let i=$index){<button role="option" [id]="'quick-link-'+i" [attr.aria-selected]="active()===i" [class.active]="active()===i" (click)="open.emit(link)"><span>{{link.label}}</span><small>{{link.detail}}</small></button>}@empty{<p>Ничего не найдено</p>}</div>
    <footer>↑ ↓ выбрать · Enter перейти</footer>
  </section></div>`,
  styles:[`:host{position:fixed;inset:0;z-index:500}.backdrop{height:100%;background:#030712aa;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px;box-sizing:border-box}section{width:560px;max-width:100%;background:#182230;color:#e5eaf2;border:1px solid #3b4b60;border-radius:14px;box-shadow:0 24px 80px #0008;overflow:hidden}header{display:flex;padding:18px;gap:12px;border-bottom:1px solid #303c4f}input{min-width:0;flex:1;font:inherit;font-size:18px;color:inherit;background:transparent;border:0;outline:none}header button{background:#2b384a;color:#cbd5e1;border:0;border-radius:5px;padding:5px 8px;cursor:pointer}#quick-results{max-height:55vh;overflow:auto;padding:8px}#quick-results button{width:100%;display:flex;flex-direction:column;gap:4px;padding:12px;text-align:left;background:transparent;border:0;border-radius:8px;color:inherit;cursor:pointer;font:inherit}#quick-results button.active,#quick-results button:hover{background:#2b4c45}small,footer{color:#afbdcf;font-size:12px}footer{padding:12px 20px;border-top:1px solid #303c4f}p{padding:16px;color:#afbdcf}`]
})
export class QuickSwitchComponent implements AfterViewInit {
  @ViewChild('queryInput') queryInput!: ElementRef<HTMLInputElement>;
  readonly query=input(''); readonly links=input<QuickLink[]>([]); readonly active=signal(0);
  readonly search=output<string>(); readonly open=output<QuickLink>(); readonly close=output<void>();
  ngAfterViewInit(){this.queryInput.nativeElement.focus();}
  onKey(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close.emit();}
    if(event.key==='Tab'){
      const dialog=this.queryInput.nativeElement.closest('section')!;
      const focusable=Array.from(dialog.querySelectorAll<HTMLElement>('input,button'));
      const at=focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();focusable[(at+(event.shiftKey?-1:1)+focusable.length)%focusable.length]?.focus();
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const n=this.links().length;if(n){this.active.set((this.active()+(event.key==='ArrowDown'?1:-1)+n)%n);document.getElementById('quick-link-'+this.active())?.scrollIntoView({block:'nearest'});}}
    if(event.key==='Enter' && event.target===this.queryInput.nativeElement){event.preventDefault();const link=this.links()[this.active()];if(link)this.open.emit(link);}
  }
}
