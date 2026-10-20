import {ChangeDetectionStrategy, Component, input} from '@angular/core';

@Component({
 selector:'app-rarity-badge',standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,
 template:`@if(value()){<span [attr.data-rarity]="value()">{{labels[value()!]??value()}}</span>}`,
 styles:[`
 :host{display:inline-block}span{display:inline-block;border-radius:5px;padding:3px 5px;font-size:10px;line-height:1.3;font-weight:600;color:#fff;background:#4b5563}
 [data-rarity=uncommon]{background:#166534}[data-rarity=rare]{background:#1d4ed8}
 [data-rarity=epic]{background:#7e22ce}[data-rarity=legendary]{background:#854d0e;color:#fff4c2}
 `]
})
export class RarityBadgeComponent {
 readonly value=input<string|null|undefined>();
 readonly labels:Partial<Record<string,string>>={common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'};
}
