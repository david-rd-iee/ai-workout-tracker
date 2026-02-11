import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonInput,
  IonButton,
  IonIcon,
  IonText,
} from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../services/account/account.service';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonContent,
    IonHeader,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
  ],
})
export class LoginPage implements OnInit {
  email = '';
  password = '';

  isIOS = false;
  isSubmitting = false;
  errorMessage = '';

  constructor(
    private accountService: AccountService,
    private platform: Platform,
    private router: Router
  ) {
    addIcons({
      'logo-apple':
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" class="ionicon" viewBox="0 0 512 512"><path d="M349.13 136.86c-40.32 0-57.36 19.24-85.44 19.24-28.79 0-50.75-19.1-85.69-19.1-34.2 0-70.67 20.88-93.83 56.45-32.52 50.16-27 144.63 25.67 225.11 18.84 28.81 44 61.12 77 61.47h.6c28.68 0 37.2-18.78 76.67-19h.6c38.88 0 46.68 18.89 75.24 18.89h.6c33-.35 59.51-36.15 78.35-64.85 13.56-20.64 18.6-31 29-54.35-76.19-28.92-88.43-136.93-13.08-178.34-23-28.8-55.32-45.48-85.79-45.48z"/><path d="M340.25 32c-24 1.63-52 16.91-68.4 36.86-14.88 18.08-27.12 44.9-22.32 70.91h1.92c25.56 0 51.72-15.39 67-35.11 14.72-18.77 25.88-45.37 21.8-72.66z"/></svg>',
    });
  }

  ngOnInit() {
    this.isIOS = this.platform.is('ios');
  }

  async onLoginSubmit() {
    this.errorMessage = '';

    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter your email and password.';
      return;
    }

    this.isSubmitting = true;
    try {
      const loggedIn = await this.accountService.login(this.email.trim(), this.password);

      if (!loggedIn) {
        this.errorMessage = 'Login failed. Check your email/password and try again.';
        return;
      }

      // If you also have an auth-state listener elsewhere, this is still fine.
      await this.router.navigateByUrl('/tabs', { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'An error occurred during login.';
    } finally {
      this.isSubmitting = false;
    }
  }

  async loginWithApple() {
    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const success = await this.accountService.signInWithApple();
      if (!success) {
        this.errorMessage = 'Failed to login with Apple.';
        return;
      }
      await this.router.navigateByUrl('/tabs', { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'An error occurred during Apple login.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
