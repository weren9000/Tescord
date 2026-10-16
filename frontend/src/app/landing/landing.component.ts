import {Component} from '@angular/core';

@Component({
  selector: 'app-landing',
  standalone: true,
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
  host: {'[class.android]': 'android'}
})
export class LandingComponent {
  readonly android = /Android/i.test(navigator.userAgent);
}
