// src/app/app.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { AccountService } from './services/account/account.service';
import { UserService } from './services/account/user.service';
import { ExerciseEstimatorsService } from './services/exercise-estimators.service';
import { NotificationService } from './services/notification.service';
import { OrientationPolicyService } from './services/orientation/orientation-policy.service';
import { environment } from '../environments/environment';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit, OnDestroy {
  private authStateSub?: Subscription;
  private profileLoadInFlight: Promise<boolean> | null = null;
  private loadedProfileUid: string | null = null;
  private estimatorInitPromise: Promise<void> | null = null;

  constructor(
    private accountService: AccountService,
    private userService: UserService,
    private exerciseEstimatorsService: ExerciseEstimatorsService,
    private notificationService: NotificationService,
    private orientationPolicyService: OrientationPolicyService,
    private router: Router
  ) {
    // Expose dev methods globally for console access
    if (!environment.production) {
      (window as any).account = this.accountService;
      (window as any).loginAndNavigate = async (email: string, password: string) => {
        const success = await this.accountService.login(email, password);
        if (success) {
          const profileLoaded = await this.userService.loadUserProfile();
          if (profileLoaded) {
            await this.router.navigate(['/tabs']);
          }
        }
        return success;
      };
    }
  }

  async ngOnInit() {
    try {
      this.orientationPolicyService.start();

      await this.handleAuthState();

      this.authStateSub = this.accountService.authStateChanges$.subscribe(() => {
        void this.handleAuthState();
      });
    } catch (error) {
      console.error('[AppComponent] Error in ngOnInit:', error);
    }
  }

  ngOnDestroy(): void {
    this.authStateSub?.unsubscribe();
  }

  private async handleAuthState() {
    const uid = (this.accountService.getCredentials()().uid || '').trim();
    if (!uid) {
      this.notificationService.stopInAppNotifications();
      this.loadedProfileUid = null;
      return;
    }

    this.initializeExerciseEstimatorsAfterLogin();
    this.notificationService.startInAppNotifications(uid);
    void this.notificationService.initPushNotifications();

    if (this.loadedProfileUid === uid) {
      return;
    }

    if (this.profileLoadInFlight) {
      await this.profileLoadInFlight;
      return;
    }

    this.profileLoadInFlight = this.userService.loadUserProfile();
    try {
      const loaded = await this.profileLoadInFlight;
      if (loaded) {
        this.loadedProfileUid = uid;
        return;
      }

      this.loadedProfileUid = null;
      const profileCompletionRoute = this.userService.getProfileCompletionRoute();
      if (!this.router.url.startsWith(profileCompletionRoute)) {
        await this.router.navigateByUrl(profileCompletionRoute, { replaceUrl: true });
      }
    } finally {
      this.profileLoadInFlight = null;
    }
  }

  private initializeExerciseEstimatorsAfterLogin(): void {
    if (this.estimatorInitPromise) {
      return;
    }

    this.estimatorInitPromise = this.exerciseEstimatorsService
      .ensureInitialized()
      .catch((error) => {
        console.error('[AppComponent] Error initializing exercise estimators:', error);
        this.estimatorInitPromise = null;
      });
  }
}
