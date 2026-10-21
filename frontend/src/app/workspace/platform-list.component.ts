import {Component,computed,input,output,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {UiIconComponent} from './ui-icon.component';
interface Choice{id:string;name:string;description?:string|null;icon:string|null;unread:number;mentions:number}
@Component({selector:'app-platform-list',standalone:true,imports:[FormsModule,UiIconComponent],
 templateUrl:'./platform-list.component.html',
 styleUrl:'./platform-list.component.scss'})
export class PlatformListComponent{
 readonly spaces=input.required<Choice[]>();readonly selected=input<string|null>(null);readonly collapsed=input(false);
 readonly select=output<string>();readonly create=output<void>();readonly join=output<void>();readonly toggle=output<void>();
 readonly query=signal('');readonly failed=signal(new Set<string>());
 readonly visible=computed(()=>this.spaces().filter(s=>s.name.toLocaleLowerCase().includes(this.query().trim().toLocaleLowerCase())));
 imageError(id:string){this.failed.update(x=>new Set([...x,id]));}
}
