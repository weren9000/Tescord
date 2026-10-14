import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, ViewEncapsulation, input, output } from '@angular/core';

/** Shared top-layer surface: anchored on desktop, bottom sheet on touch-sized screens. */
@Component({
  selector: 'app-action-menu', standalone: true, encapsulation: ViewEncapsulation.None,
  template: `<dialog #dialog class="action-menu" [attr.aria-label]="label()" (cancel)="dismiss($event)"
    (keydown)="onKeydown($event)" (pointerdown)="backdropDown = $event.target === dialog" (click)="onBackdrop($event)">
    <header class="action-menu__header"><strong>{{ label() }}</strong><button type="button" aria-label="Закрыть меню" (click)="close.emit()">×</button></header>
    <div class="action-menu__body"><ng-content /></div>
  </dialog>`,
  styles: [`
    .action-menu,.action-menu *{box-sizing:border-box}.action-menu{font-family:inherit}
    dialog.action-menu{position:fixed;inset:auto;margin:0;box-sizing:border-box;width:min(340px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:8px;border:1px solid var(--palette-border);border-radius:14px;background:var(--palette-surface);color:var(--palette-text);box-shadow:0 12px 40px rgb(0 0 0 / .22);overflow:auto;overscroll-behavior:contain}
    dialog.action-menu::backdrop{background:rgb(0 0 0 / .25)}
    .action-menu__header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 6px 8px;border-bottom:1px solid var(--palette-border);font:600 14px system-ui}
    .action-menu .action-menu__header button{width:36px;min-height:36px;flex:0 0 36px;justify-content:center;font-size:24px;padding:0}
    .action-menu__body{padding-top:4px}.action-menu__body section+section{border-top:1px solid var(--palette-border);margin-top:6px;padding-top:6px}
    .action-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:var(--palette-text);text-align:left;font:inherit;font-size:14px;line-height:1.4;cursor:pointer}
    .action-menu button:hover{background:var(--palette-hover)}.action-menu button:focus-visible{outline:2px solid var(--palette-primary);outline-offset:-2px;background:var(--palette-hover)}
    .action-menu button:disabled{opacity:.5;cursor:wait}.action-menu button.danger{color:var(--palette-danger,#da5462)}
    .action-menu .menu-heading{margin:8px 12px 4px;color:var(--palette-muted);font:500 11px system-ui;text-transform:uppercase;letter-spacing:.06em}
    .action-menu .menu-note{margin:8px 12px;color:var(--palette-muted);font-size:13px;line-height:1.5}
    @media(max-width:980px){dialog.action-menu{inset:auto 0 0!important;width:100%;max-width:100%;max-height:85dvh;border-radius:18px 18px 0 0;padding:12px 12px calc(12px + env(safe-area-inset-bottom))}.action-menu button{min-height:48px}.action-menu__header button{width:44px}.action-menu::backdrop{background:rgb(0 0 0 / .45)}}
  `],
})
export class ActionMenuComponent implements AfterViewInit, OnDestroy {
  readonly label = input.required<string>();
  readonly close = output<void>();
  @ViewChild('dialog', {static: true}) dialog!: ElementRef<HTMLDialogElement>;
  private opener: HTMLElement | null = null;
  private observer?: ResizeObserver;
  backdropDown = false;
  private readonly reposition = () => this.position();

  ngAfterViewInit(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.dialog.nativeElement.showModal();
    this.position();
    this.observer = new ResizeObserver(this.reposition);
    this.observer.observe(this.dialog.nativeElement);
    window.addEventListener('resize', this.reposition);
    window.visualViewport?.addEventListener('resize', this.reposition);
    this.buttons()[0]?.focus();
  }
  ngOnDestroy(): void {
    this.observer?.disconnect();
    window.removeEventListener('resize', this.reposition);
    window.visualViewport?.removeEventListener('resize', this.reposition);
    this.dialog.nativeElement.close();
    // Do not steal focus from the next modal opened by a selected action.
    const remaining = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
    if (this.opener?.isConnected && (!remaining || remaining.contains(this.opener))) this.opener.focus({preventScroll: true});
  }
  dismiss(event: Event): void { event.preventDefault(); this.close.emit(); }
  onBackdrop(event: MouseEvent): void {
    const outside = this.backdropDown; this.backdropDown = false;
    if (!outside || event.target !== this.dialog.nativeElement) return;
    const r = this.dialog.nativeElement.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.close.emit();
  }
  onKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Tab') {
      const focusable = Array.from(this.dialog.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || (event.target as HTMLElement).matches('input,select,textarea')) return;
    const buttons = this.buttons(); if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[index].focus();
  }
  private buttons(): HTMLButtonElement[] { return Array.from(this.dialog.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(button => button.getClientRects().length > 0); }
  private position(): void {
    const dialog = this.dialog.nativeElement;
    const anchor = this.opener?.getBoundingClientRect();
    const width = dialog.offsetWidth, height = dialog.offsetHeight;
    dialog.style.left = `${Math.max(12, Math.min(anchor?.left ?? 12, window.innerWidth - width - 12))}px`;
    const below = anchor?.bottom ?? 12;
    dialog.style.top = `${Math.max(12, Math.min(below + 6, window.innerHeight - height - 12))}px`;
  }
}
