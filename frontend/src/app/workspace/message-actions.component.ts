import {AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, input, output, signal} from '@angular/core';

@Component({
  selector:'app-message-actions',standalone:true,
  template:`<dialog #dialog aria-labelledby="message-actions-title" (cancel)="close.emit()" (pointerdown)="backdropDown = $event.target === dialog" (click)="backdrop($event)">
    <h2 id="message-actions-title">Действия с сообщением</h2>
    <button type="button" (click)="choose.emit('reply')">Ответить</button>
    @if (text()) { <button type="button" (click)="copy()">Скопировать текст</button> }
    <button type="button" (click)="choose.emit('reaction')">Добавить реакцию</button>
    @if (error()) { <p role="status">{{error()}}</p> }
    <button type="button" (click)="close.emit()">Закрыть</button>
  </dialog>`,
  styles:[`
    dialog { width:min(360px,calc(100vw - 24px));box-sizing:border-box;padding:16px;border:1px solid var(--palette-border);border-radius:16px;background:var(--palette-surface);color:var(--palette-text); }
    dialog::backdrop { background:rgb(0 0 0 / .5); }
    h2 {font-family:inherit;font-weight:600;line-height:1.4;margin:0 0 12px;font-size:16px;}
    button {display:block;width:100%;min-height:44px;margin-top:4px;padding:10px 12px;text-align:left;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;}
    button:hover,button:focus-visible {background:var(--palette-hover);outline:2px solid var(--palette-primary);outline-offset:-2px;}
    p {font-size:13px;}
    @media(max-width:640px){dialog{margin:auto 0 0;width:100%;max-width:100%;border-radius:16px 16px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom));}}
  `],
})
export class MessageActionsComponent implements AfterViewInit, OnDestroy {
  readonly text=input('');
  readonly choose=output<'reply'|'reaction'>();
  readonly close=output<void>();
  readonly error=signal('');
  backdropDown=false;
  @ViewChild('dialog',{static:true}) dialog!:ElementRef<HTMLDialogElement>;
  ngAfterViewInit():void {this.dialog.nativeElement.showModal();}
  ngOnDestroy():void {this.dialog.nativeElement.close();}
  backdrop(event:MouseEvent):void {
    const startedOnBackdrop=this.backdropDown;this.backdropDown=false;
    if(!startedOnBackdrop || event.target!==this.dialog.nativeElement)return;
    const rect=this.dialog.nativeElement.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)this.close.emit();
  }
  async copy():Promise<void>{
    try {await navigator.clipboard.writeText(this.text());this.close.emit();}
    catch {this.error.set('Не удалось скопировать текст. Разрешите доступ к буферу обмена.');}
  }
}
