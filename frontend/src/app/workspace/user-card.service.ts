import {Injectable, signal} from '@angular/core';
@Injectable({providedIn:'root'})
export class UserCardService {
  readonly selected=signal<{id:string;anchor:HTMLElement;rect:DOMRect}|null>(null);
  readonly revision=signal(0);
  open(id:string,anchor:HTMLElement){if(!id)return;this.selected.set({id,anchor,rect:anchor.getBoundingClientRect()});}
  close(){const anchor=this.selected()?.anchor;this.selected.set(null);if(anchor?.isConnected)anchor.focus({preventScroll:true});}
}
