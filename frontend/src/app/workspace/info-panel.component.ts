import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, input, output } from '@angular/core';

/** Nonmodal desktop sidebar; native modal full-screen panel on mobile. */
@Component({
  selector: 'app-info-panel', standalone: true,
  template: `<dialog #panel [attr.aria-label]="label()" (cancel)="dismiss($event)" (keydown)="keydown($event)">
    <header><button type="button" aria-label="Вернуться к переписке" (click)="close.emit()">‹</button><h2>{{label()}}</h2><button type="button" aria-label="Закрыть информацию" (click)="close.emit()">×</button></header>
    <div class="content"><ng-content /></div>
  </dialog>`,
  styles: [`
    :host{display:block;min-width:0;min-height:0;height:100%;border-left:1px solid var(--palette-border);background:var(--palette-surface)}
    dialog{box-sizing:border-box;position:static;inset:auto;margin:0;border:0;padding:0;width:100%;height:100%;max-width:none;max-height:none;background:var(--palette-surface);color:var(--palette-text);overflow:auto;font:inherit;overscroll-behavior:contain}
    header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;padding:12px;background:var(--palette-surface);border-bottom:1px solid var(--palette-border)}h2{flex:1;font:600 15px system-ui;margin:0}
    header button{width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;font-size:25px;cursor:pointer}header button:hover{background:var(--palette-hover)}button:focus-visible{outline:2px solid var(--palette-primary)}header button:first-child{display:none}.content{padding:18px}
    @media(max-width:980px){:host{position:fixed;inset:0;z-index:150}dialog{position:fixed;inset:0;width:100%;height:100dvh;max-height:100dvh;padding-bottom:env(safe-area-inset-bottom)}header button:first-child{display:block}dialog::backdrop{background:var(--palette-canvas)}}
  `],
})
export class InfoPanelComponent implements AfterViewInit, OnDestroy {
  readonly label = input.required<string>();
  readonly close = output<void>();
  @ViewChild('panel', {static:true}) panel!: ElementRef<HTMLDialogElement>;
  private opener: HTMLElement | null = null;
  private readonly mobile = window.matchMedia('(max-width:980px)');
  private readonly update = () => {
    const dialog = this.panel.nativeElement;
    dialog.close();
    if (this.mobile.matches) dialog.showModal(); else dialog.show();
  };
  ngAfterViewInit(): void { this.opener = document.activeElement as HTMLElement; this.update(); this.mobile.addEventListener('change',this.update); this.panel.nativeElement.querySelector<HTMLButtonElement>('button:last-child')?.focus({preventScroll:true}); }
  ngOnDestroy(): void { this.mobile.removeEventListener('change',this.update); this.panel.nativeElement.close(); if(this.opener?.isConnected && !document.querySelector('dialog:modal')) this.opener.focus({preventScroll:true}); }
  dismiss(event:Event): void { event.preventDefault();this.close.emit(); }
  keydown(event:KeyboardEvent): void {
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close.emit();return;}
    if(event.key!=='Tab'||!this.mobile.matches)return;
    const nodes=Array.from(this.panel.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]')).filter(e=>e.getClientRects().length);
    const first=nodes[0],last=nodes[nodes.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
}
