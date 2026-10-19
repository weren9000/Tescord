import {Directive, ElementRef, HostListener, inject, input} from '@angular/core';
import {UserCardService} from './user-card.service';
@Directive({selector:'[appUserCard]',standalone:true,host:{'[attr.role]':'appUserCard() ? "button" : null','[attr.tabindex]':'appUserCard() ? 0 : null','[attr.aria-label]':'label()','[attr.aria-haspopup]':'appUserCard() ? "dialog" : null','[class.user-card-trigger]':'!!appUserCard()'}})
export class UserCardDirective {
  readonly appUserCard=input<string|null|undefined>();
  private readonly element=inject(ElementRef<HTMLElement>);private readonly cards=inject(UserCardService);
  label(){if(!this.appUserCard())return this.element.nativeElement.getAttribute('title');const name=this.element.nativeElement.getAttribute('alt');return name?'Открыть карточку: '+name:'Открыть карточку пользователя';}
  @HostListener('click',['$event']) open(event:Event){const id=this.appUserCard();if(!id)return;event.preventDefault();event.stopPropagation();this.cards.open(id,this.element.nativeElement);}
  @HostListener('keydown',['$event']) key(event:KeyboardEvent){if(event.key==='Enter'||event.key===' ')this.open(event);}
  @HostListener('pointerdown',['$event']) down(event:PointerEvent){if(this.appUserCard())event.stopPropagation();}
}
