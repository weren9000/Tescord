import { Component, input } from '@angular/core';

@Component({
  selector: 'app-guest-header',
  standalone: true,
  templateUrl: './guest-header.component.html',
  styleUrl: './guest-header.component.css',
})
export class GuestHeaderComponent {
  readonly showLogin = input(true);
}
