import {Component, input, output, signal} from '@angular/core';
import {UiIconComponent} from './ui-icon.component';
import {ActionMenuComponent} from './action-menu.component';

@Component({
  selector:'app-file-attachment',standalone:true,imports:[UiIconComponent,ActionMenuComponent],
  template:`
    <div class="file-card" [class.unavailable]="unavailable()">
      <button type="button" class="file-main" [disabled]="unavailable() || (!previewable() && downloading())" [title]="name()" [attr.aria-label]="(previewable()?'Просмотреть ':'Скачать ')+name()" (click)="activate()">
        <span class="file-symbol"><app-ui-icon [name]="codeFile()?'code':'files'"/></span>
        <span class="file-copy"><strong>{{name()}}</strong><small>{{meta()}}</small></span>
      </button>
      <div class="file-actions" role="group" aria-label="Действия с файлом">
        @if(previewable()){<button class="file-action" type="button" title="Просмотреть" aria-label="Просмотреть файл" [disabled]="unavailable()" (click)="preview.emit()"><app-ui-icon name="eye"/></button>}
        <button class="file-action" type="button" [title]="downloading()?'Скачивание…':'Скачать'" aria-label="Скачать файл" [disabled]="unavailable() || downloading()" (click)="download.emit()"><app-ui-icon name="download"/></button>
        @if(deletable()){<button class="file-action" type="button" title="Другие действия" aria-label="Другие действия с файлом" aria-haspopup="dialog" [attr.aria-expanded]="menuOpen()" [disabled]="deleting()" (click)="menuOpen.set(true)"><app-ui-icon name="more"/></button>}
      </div>
      @if(unavailable() || downloading() || deleting()){<small class="file-status" role="status">{{deleting()?'Удаление…':downloading()?'Скачивание…':state()}}</small>}
    </div>
    @if(menuOpen()){
      <app-action-menu label="Действия с файлом" (close)="menuOpen.set(false)">
        <p class="file-menu-name">{{name()}}</p>
        <button type="button" class="danger" [disabled]="deleting()" (click)="menuOpen.set(false);remove.emit()"><app-ui-icon name="trash"/>Удалить файл</button>
      </app-action-menu>
    }
  `,
  styles:[`
    :host{display:block;min-width:0;max-width:100%;width:100%}*{box-sizing:border-box}
    .file-card{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px;border:1px solid var(--palette-border);border-radius:10px;background:color-mix(in srgb,var(--palette-surface) 35%,transparent);min-width:0;max-width:100%}
    button{font:inherit;color:var(--palette-text);cursor:pointer;border:0;background:transparent;border-radius:8px}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--palette-primary);outline-offset:-2px}button:hover:not(:disabled){background:var(--palette-hover)}
    .file-main{display:flex;align-items:center;gap:8px;flex:1 1 140px;min-width:0;max-width:100%;padding:5px;text-align:left;min-height:44px}.file-symbol{display:grid;place-items:center;flex:0 0 28px;width:28px;height:32px;color:var(--palette-primary-text,var(--palette-primary))}
    .file-copy{min-width:0;flex:1}.file-copy strong,.file-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-copy strong{font-size:13px;line-height:1.4}.file-copy small{font-size:11px;color:var(--palette-muted);line-height:1.5;margin-top:3px}
    .file-actions{display:flex;flex:0 0 auto;gap:2px;margin-left:auto;max-width:100%;flex-wrap:wrap}.file-action{display:grid;place-items:center;width:36px;height:36px;flex:0 0 36px;padding:8px}.file-action app-ui-icon{width:20px;height:20px;display:block}.file-status{flex:0 0 100%;font-size:11px;color:var(--palette-muted);padding:2px 5px}.file-menu-name{font-size:12px;color:var(--palette-muted);overflow-wrap:anywhere;padding:0 12px}
    @media(max-width:980px),(pointer:coarse){.file-action{width:44px;height:44px;flex-basis:44px;padding:12px}}
  `]
})
export class FileAttachmentComponent {
  readonly name=input.required<string>();readonly meta=input('');readonly state=input('');
  readonly previewable=input(false);readonly unavailable=input(false);readonly downloading=input(false);readonly deleting=input(false);readonly deletable=input(false);
  readonly preview=output<void>();readonly download=output<void>();readonly remove=output<void>();readonly menuOpen=signal(false);
  codeFile():boolean{return this.previewable() && !/\.(md|markdown|txt|log|csv)$/i.test(this.name());}
  activate():void {if(this.previewable())this.preview.emit();else this.download.emit();}
}
