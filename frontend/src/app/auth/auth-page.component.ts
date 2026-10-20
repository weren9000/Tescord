import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthFormStore } from '../core/services/auth-form.store';
import { GuestHeaderComponent } from '../landing/guest-header.component';

@Component({
  selector: 'app-auth-page',
  imports: [FormsModule, GuestHeaderComponent],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
})
export class AuthPageComponent {
  readonly form = inject(AuthFormStore);
}
