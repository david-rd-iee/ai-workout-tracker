import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonSelect,
  IonSelectOption,
  IonText,
} from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AccountService } from 'src/app/services/account/account.service';
import { Router, RouterLink } from '@angular/router';
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
    IonSelect,
    IonSelectOption,
    IonText,
  ],
})
export class SignUpPage implements OnInit, OnDestroy {
  firstName = '';
  lastName = '';
  email = '';
  password = '';
  confirmPassword = '';
  age: string | number = '';
  sex: string | number | null = null;
  heightMeters: string | number = '';
  weightKg: string | number = '';
  readonly sexOptions = [
    { value: 1, label: 'Male' },
    { value: 2, label: 'Female' },
    { value: 1.5, label: 'Other' },
  ];

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
  ) {}

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

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const email = this.email.trim();
    const age = this.parsePositiveInteger(this.age);
    const sex = this.parseSexValue(this.sex);
    const heightMeters = this.parsePositiveNumber(this.heightMeters);
    const weightKg = this.parsePositiveNumber(this.weightKg);

    if (
      !firstName ||
      !lastName ||
      !email ||
      !this.password ||
      !this.confirmPassword
    ) {
      this.errorMessage = 'Please fill out all fields.';
      return;
    }
    if (this.passwordMismatch) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    if (age === null) {
      this.errorMessage = 'Please enter a valid age.';
      return;
    }
    if (sex === null) {
      this.errorMessage = 'Please select sex.';
      return;
    }
    if (heightMeters === null || heightMeters <= 0) {
      this.errorMessage = 'Please enter a valid height in meters.';
      return;
    }
    if (weightKg === null || weightKg <= 0) {
      this.errorMessage = 'Please enter a valid weight in kilograms.';
      return;
    }

    this.isSubmitting = true;
    try {
      const success = await this.accountService.signup(email, this.password);

      if (!success) {
        this.errorMessage = 'Sign up failed. Try a different email or password.';
        return;
      }

      await this.router.navigateByUrl('/complete-profile', {
        replaceUrl: true,
        state: {
          onboardingProfile: {
            firstName,
            lastName,
            age,
            sex,
            heightMeters,
            weightKg,
          },
        },
      });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'An error occurred during sign up.';
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

  private parsePositiveNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private parsePositiveInteger(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      return null;
    }

    return parsed;
  }

  private parseSexValue(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (parsed === 1 || parsed === 1.5 || parsed === 2) {
      return parsed;
    }

    return null;
  }
}
