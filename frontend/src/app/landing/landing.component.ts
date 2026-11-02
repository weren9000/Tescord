import { Component } from '@angular/core';
import { GuestHeaderComponent } from './guest-header.component';
import { NewsFeedComponent } from './news-feed.component';
import { UiIconComponent } from '../workspace/ui-icon.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [GuestHeaderComponent, NewsFeedComponent, UiIconComponent],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
  host: { '[class.android]': 'android' },
})
export class LandingComponent {
  readonly android = /Android/i.test(navigator.userAgent);
}
