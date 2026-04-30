import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonText,
} from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../services/account/account.service';
import { UserService } from '../../services/account/user.service';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import {
  STATUES_DASHBORD_URL,
  STATUES_DASHBOARD_ALIAS_URL,
} from '../statues-dashbord/statues-dashbord.constants';

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
    IonItem,
    IonInput,
    IonButton,
    IonText,
  ],
})
export class LoginPage implements OnInit, OnDestroy {
  email = '';
  password = '';
  resetMessage = '';

  isIOS = false;
  isIOSKeyboardOpen = false;
  iosKeyboardHeight = 0;
  isSubmitting = false;
  errorMessage = '';
  private redirectUrl = '/tabs';
  private keyboardListeners: PluginListenerHandle[] = [];
  private removeViewportListeners: Array<() => void> = [];
  private shouldUseKeyboardScrollLock = false;

  constructor(
    private accountService: AccountService,
    private userService: UserService,
    private platform: Platform,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.isIOS = this.platform.is('ios');
    this.shouldUseKeyboardScrollLock = this.platform.is('iphone');
    if (this.shouldUseKeyboardScrollLock) {
      this.initKeyboardScrollLock();
    }

    const candidateRedirect = (this.route.snapshot.queryParamMap.get('redirectTo') || '').trim();
    if (candidateRedirect.startsWith('/')) {
      this.redirectUrl = candidateRedirect;
    }

    const authError = (this.route.snapshot.queryParamMap.get('authError') || '').trim();
    if (authError) {
      this.errorMessage = authError;
    }
  }

  ngOnDestroy(): void {
    this.keyboardListeners.forEach((listener) => void listener.remove());
    this.keyboardListeners = [];

    this.removeViewportListeners.forEach((remove) => remove());
    this.removeViewportListeners = [];
  }

  async onLoginSubmit() {
    this.errorMessage = '';
    this.resetMessage = '';
    this.accountService.clearLastAuthError();

    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter your email and password.';
      return;
    }

    this.isSubmitting = true;
    try {
      const loggedIn = await this.accountService.login(this.email.trim(), this.password);

      if (!loggedIn) {
        this.errorMessage =
          this.accountService.getLastAuthErrorMessage() ||
          'Login failed. Check your email/password and try again.';
        return;
      }

      if (
        this.redirectUrl.startsWith(STATUES_DASHBORD_URL) ||
        this.redirectUrl.startsWith(STATUES_DASHBOARD_ALIAS_URL)
      ) {
        await this.router.navigateByUrl(this.redirectUrl, { replaceUrl: true });
        return;
      }

      const profileLoaded = await this.userService.loadUserProfile();
      if (!profileLoaded) {
        await this.router.navigateByUrl(this.userService.getProfileCompletionRoute(), { replaceUrl: true });
        return;
      }

      await this.router.navigateByUrl(this.redirectUrl, { replaceUrl: true });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'An error occurred during login.';
    } finally {
      this.isSubmitting = false;
    }
  }

  async onForgotPassword(): Promise<void> {
    this.errorMessage = '';
    this.resetMessage = '';
    this.accountService.clearLastAuthError();

    if (!this.email.trim()) {
      this.errorMessage = 'Enter your email address to reset your password.';
      return;
    }

    this.isSubmitting = true;
    try {
      const result = await this.accountService.sendPasswordReset(this.email);
      if (!result.success) {
        this.errorMessage = result.message;
        return;
      }

      this.resetMessage = result.message;
    } catch (error) {
      console.error(error);
      this.errorMessage = 'Unable to send reset email right now.';
    } finally {
      this.isSubmitting = false;
    }
  }

  startDemoMode(): void {
    void this.router.navigateByUrl('/demo-setup');
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
