import {Component,input,output} from '@angular/core';
import {WorkspaceMessageAttachment} from '../core/models/workspace.models';
import {PhotoThumbnailComponent} from './photo-thumbnail.component';

export function isPhoto(attachment:WorkspaceMessageAttachment):boolean {
  return !attachment.deleted_at && (/^image\/(png|jpe?g|webp|gif)$/i.test(attachment.mime_type) || /\.(png|jpe?g|webp|gif)$/i.test(attachment.filename));
}
@Component({selector:'app-photo-grid',standalone:true,imports:[PhotoThumbnailComponent],template:`
  <div class="grid" [class.single]="photos().length===1" [class.three]="photos().length===3">
    @for(photo of photos().slice(0,4);track photo.id;let i=$index){
      <button type="button" [attr.aria-label]="'Открыть фото '+(i+1)+' из '+photos().length+': '+photo.filename" (click)="open.emit(photo)" (contextmenu)="$event.stopPropagation()">
        <app-photo-thumbnail [id]="photo.id" [token]="token()" [name]="photo.filename" [crop]="photos().length>1"/>
        @if(photo.mime_type==='image/gif' || photo.filename.toLowerCase().endsWith('.gif')){<span class="gif">GIF</span>}
        @if(i===3 && photos().length>4){<span class="more">+{{photos().length-4}}</span>}
      </button>
    }
  </div>
`,styles:[`
 :host{display:block;width:320px;max-width:100%;min-width:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;height:240px;overflow:hidden;border:1px solid var(--palette-border);border-radius:12px}.grid.single{grid-template-columns:1fr}.three button:first-child{grid-row:span 2}button{display:block;position:relative;min-width:0;min-height:0;padding:0;border:0;background:var(--palette-canvas);cursor:zoom-in;overflow:hidden;color:white}button:focus-visible{outline:3px solid var(--palette-primary);outline-offset:-3px}.more{position:absolute;inset:0;display:grid;place-content:center;background:#0008;font-size:28px;font-weight:700;pointer-events:none}.gif{position:absolute;left:6px;bottom:6px;border-radius:4px;padding:3px 5px;font-size:10px;background:#000b;pointer-events:none}
`]})
export class PhotoGridComponent {readonly photos=input.required<WorkspaceMessageAttachment[]>();readonly token=input.required<string>();readonly open=output<WorkspaceMessageAttachment>();}
