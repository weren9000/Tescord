import {Component} from '@angular/core';
import {GuestHeaderComponent} from './guest-header.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [GuestHeaderComponent],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
  host: {'[class.android]': 'android'}
})
export class LandingComponent {
  readonly android = /Android/i.test(navigator.userAgent);
}
