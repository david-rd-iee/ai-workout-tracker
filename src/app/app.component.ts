// src/app/app.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { DevSeedService } from './services/dev-seed.service';
import { AccountService } from './services/account/account.service';
import { UserService } from './services/account/user.service';
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

  constructor(
    private devSeedService: DevSeedService,
    private accountService: AccountService,
    private userService: UserService,
    private router: Router
  ) {
    // Expose dev methods globally for console access
    if (!environment.production) {
      (window as any).devSeed = this.devSeedService;
      (window as any).account = this.accountService;
      (window as any).connectClientToTrainer = async () => {
        await this.devSeedService.connectClientToTrainer();
      };
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
      this.loadedProfileUid = null;
      return;
    }

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
      }
    } finally {
      this.profileLoadInFlight = null;
    }
  }
}
