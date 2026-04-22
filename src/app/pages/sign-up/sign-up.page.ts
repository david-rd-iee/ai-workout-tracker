import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonIcon,
  IonText,
} from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AccountService } from 'src/app/services/account/account.service';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

@Component({
  selector: 'app-sign-up',
  templateUrl: './sign-up.page.html',
  styleUrls: ['./sign-up.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
  ],
})
export class SignUpPage implements OnInit, OnDestroy {
  email = '';
  password = '';
  confirmPassword = '';

  isIOS = false;
  isIOSKeyboardOpen = false;
  iosKeyboardHeight = 0;
  isSubmitting = false;
  errorMessage = '';
  private keyboardListeners: PluginListenerHandle[] = [];
  private removeViewportListeners: Array<() => void> = [];
  private shouldUseKeyboardScrollLock = false;

  get passwordMismatch(): boolean {
    return this.password !== this.confirmPassword && this.confirmPassword.length > 0;
  }

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
    this.shouldUseKeyboardScrollLock = this.platform.is('iphone');
    if (this.shouldUseKeyboardScrollLock) {
      this.initKeyboardScrollLock();
    }
  }

  ngOnDestroy(): void {
    this.keyboardListeners.forEach((listener) => void listener.remove());
    this.keyboardListeners = [];

    this.removeViewportListeners.forEach((remove) => remove());
    this.removeViewportListeners = [];
  }

  async onSignupSubmit() {
    this.errorMessage = '';

    if (!this.email || !this.password || !this.confirmPassword) {
      this.errorMessage = 'Please fill out all fields.';
      return;
    }
    if (this.passwordMismatch) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    this.isSubmitting = true;
    try {
      const success = await this.accountService.signup(this.email.trim(), this.password);

      if (!success) {
        this.errorMessage = 'Sign up failed. Try a different email or password.';
        return;
      }

      // After signup route to basic profile completion before entering app
      await this.router.navigateByUrl('/complete-profile', { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'An error occurred during sign up.';
    } finally {
      this.isSubmitting = false;
    }
  }

  async signUpWithApple() {
    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const success = await this.accountService.signInWithApple();
      if (!success) {
        this.errorMessage = 'Failed to sign up with Apple.';
        return;
      }
      await this.router.navigateByUrl('/complete-profile', { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'An error occurred during Apple sign up.';
    } finally {
      this.isSubmitting = false;
    }
  }

  private initKeyboardScrollLock(): void {
    if (Capacitor.isNativePlatform()) {
      void this.bindNativeKeyboardListeners();
    }

    this.bindViewportKeyboardListeners();
  }

  private async bindNativeKeyboardListeners(): Promise<void> {
    const showHandler = (info: { keyboardHeight: number }) => {
      const nativeHeight = this.normalizeKeyboardHeight(info?.keyboardHeight ?? 0);
      const viewportHeight = this.getViewportKeyboardHeight();
      this.setKeyboardState(Math.max(nativeHeight, viewportHeight));
    };

    const hideHandler = () => {
      this.setKeyboardState(0);
    };

    const willShow = await Keyboard.addListener('keyboardWillShow', showHandler);
    const didShow = await Keyboard.addListener('keyboardDidShow', showHandler);
    const willHide = await Keyboard.addListener('keyboardWillHide', hideHandler);
    const didHide = await Keyboard.addListener('keyboardDidHide', hideHandler);

    this.keyboardListeners.push(willShow, didShow, willHide, didHide);
  }

  private bindViewportKeyboardListeners(): void {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return;
    }

    const updateKeyboardStateFromViewport = () => {
      const viewportHeight = this.getViewportKeyboardHeight();

      if (viewportHeight > 0) {
        this.setKeyboardState(Math.max(this.iosKeyboardHeight, viewportHeight));
        return;
      }

      if (!Capacitor.isNativePlatform()) {
        this.setKeyboardState(0);
      }
    };

    window.visualViewport.addEventListener('resize', updateKeyboardStateFromViewport);
    window.visualViewport.addEventListener('scroll', updateKeyboardStateFromViewport);

    this.removeViewportListeners.push(() =>
      window.visualViewport?.removeEventListener('resize', updateKeyboardStateFromViewport)
    );
    this.removeViewportListeners.push(() =>
      window.visualViewport?.removeEventListener('scroll', updateKeyboardStateFromViewport)
    );

    updateKeyboardStateFromViewport();
  }

  private setKeyboardState(height: number): void {
    const normalizedHeight = this.normalizeKeyboardHeight(height);
    this.iosKeyboardHeight = normalizedHeight;
    this.isIOSKeyboardOpen = normalizedHeight > 0;
  }

  private normalizeKeyboardHeight(height: number): number {
    const roundedHeight = Math.max(0, Math.round(height || 0));
    return roundedHeight >= 120 ? roundedHeight : 0;
  }

  private getViewportKeyboardHeight(): number {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return 0;
    }

    return this.normalizeKeyboardHeight(
      window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
    );
  }
}
