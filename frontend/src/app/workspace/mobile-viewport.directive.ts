import {AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject} from '@angular/core';

/** Keep the chat inside the visible area, including browsers that only resize the visual viewport. */
@Directive({selector:'[appMobileViewport]',standalone:true})
export class MobileViewportDirective implements AfterViewInit, OnDestroy {
  private readonly host:HTMLElement=inject(ElementRef).nativeElement;
  private readonly zone=inject(NgZone);
  private frame=0;
  private observer?:ResizeObserver;
  private baseline=0;
  private width=0;
  private pinned=true;
  private previousList:HTMLElement|null=null;
  private previousComposer:HTMLElement|null=null;
  private readonly viewport=window.visualViewport;
  private readonly schedule=()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.update();});};
  private readonly trackScroll=(event:Event)=>{
    const list=event.target as HTMLElement;
    if(list.matches?.('.message-list'))this.pinned=list.scrollHeight-list.scrollTop-list.clientHeight<80;
  };
  ngAfterViewInit(){this.zone.runOutsideAngular(()=>{
    window.addEventListener('resize',this.schedule);
    this.viewport?.addEventListener('resize',this.schedule);
    this.viewport?.addEventListener('scroll',this.schedule);
    this.host.addEventListener('focusin',this.schedule);
    this.host.addEventListener('focusout',this.schedule);
    this.host.addEventListener('scroll',this.trackScroll,true);
    this.observer=new ResizeObserver(this.schedule);
    this.observer.observe(this.host);
    this.schedule();
  });}
  private update(){
    if(window.innerWidth>980){this.host.classList.remove('mobile-keyboard-open');return;}
    // Pinch zoom must stay under browser control, rather than reflowing the chat.
    if(this.viewport && Math.abs(this.viewport.scale-1)>.05)return;
    const height=this.viewport?.height??window.innerHeight;
    const width=window.innerWidth;
    const editing=!!document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    if(Math.abs(width-this.width)>40){this.baseline=height;this.width=width;}
    if(!editing)this.baseline=height;
    else this.baseline=Math.max(this.baseline,height);
    const keyboard=editing&&Math.max(this.baseline-height,window.innerHeight-height)>100;
    this.host.style.setProperty('--mobile-height',`${height}px`);
    this.host.style.setProperty('--mobile-top',`${this.viewport?.offsetTop??0}px`);
    this.host.classList.toggle('mobile-keyboard-open',keyboard);
    const list=this.host.querySelector<HTMLElement>('.message-list');
    if(list!==this.previousList){this.previousList=list;this.pinned=true;}
    const composer=this.host.querySelector<HTMLElement>('.composer');
    if(composer!==this.previousComposer){
      if(this.previousComposer)this.observer?.unobserve(this.previousComposer);
      this.previousComposer=composer;
      if(composer)this.observer?.observe(composer);
    }
    if(composer)this.host.style.setProperty('--composer-height',`${composer.offsetHeight}px`);
    if(list&&this.pinned)list.scrollTop=list.scrollHeight;
  }
  ngOnDestroy(){
    cancelAnimationFrame(this.frame);this.observer?.disconnect();
    window.removeEventListener('resize',this.schedule);
    this.viewport?.removeEventListener('resize',this.schedule);this.viewport?.removeEventListener('scroll',this.schedule);
    this.host.removeEventListener('focusin',this.schedule);this.host.removeEventListener('focusout',this.schedule);
    this.host.removeEventListener('scroll',this.trackScroll,true);
  }
}
