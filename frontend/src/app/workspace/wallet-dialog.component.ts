import {AfterViewInit, Component, ElementRef, ViewChild, input, output} from '@angular/core';
import {WalletComponent} from './wallet.component';
@Component({selector:'app-wallet-dialog',standalone:true,imports:[WalletComponent],template:`<dialog #dialog aria-label="Кошелёк" (cancel)="$event.preventDefault(); close.emit()"><app-wallet [token]="token()" (close)="close.emit()"/></dialog>`,styles:[`dialog{box-sizing:border-box;width:min(620px,calc(100vw - 24px));max-height:90dvh;overflow:auto;padding:0;border:1px solid var(--palette-border);border-radius:14px;background:var(--palette-surface);color:var(--palette-text)}dialog::backdrop{background:#0008}`]})
export class WalletDialogComponent implements AfterViewInit {
  readonly token=input.required<string>();readonly close=output<void>();
  @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
  ngAfterViewInit(){this.dialog.nativeElement.showModal();}
}
