// src/app/app.component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { DevSeedService } from './services/dev-seed.service';
import { AccountService } from './services/account/account.service';
import { UserService } from './services/account/user.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {

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
          console.log('Login successful, loading profile...');
          const profileLoaded = await this.userService.loadUserProfile();
          if (profileLoaded) {
            console.log('Profile loaded, navigating to tabs...');
            await this.router.navigate(['/tabs']);
          } else {
            console.log('No profile found, navigate to profile creation');
          }
        } else {
          console.log('Login failed');
        }
        return success;
      };
    }
  }

  async ngOnInit() {
    console.log('[AppComponent] ngOnInit - VERSION 2.0');
    // Dev seed can be run manually via console: window['devSeed'].ensureDevUserAndSeed()
    
    try {
      // Check current auth state first (in case user is already logged in)
      console.log('[AppComponent] Checking initial auth state...');
      await this.handleAuthState();
      
      // Listen to auth state changes and handle navigation
      this.accountService.authStateChanges$.subscribe(async (authState) => {
        console.log('[AppComponent] Auth state changed event received:', authState);
        await this.handleAuthState();
      });
    } catch (error) {
      console.error('[AppComponent] Error in ngOnInit:', error);
    }
  }

  private async handleAuthState() {
    const isLoggedIn = this.accountService.isLoggedIn()();
    console.log('[AppComponent] handleAuthState - isLoggedIn:', isLoggedIn);
    
    if (isLoggedIn) {
      console.log('[AppComponent] User authenticated, loading profile...');
      const profileLoaded = await this.userService.loadUserProfile();
      console.log('[AppComponent] Profile loaded:', profileLoaded);

      // Do not auto-navigate authenticated users on app startup.
      // Login and signup pages handle navigation after explicit user actions.
      if (!profileLoaded) {
        console.log('[AppComponent] No profile found, waiting for explicit navigation.');
      }
    } else {
      console.log('[AppComponent] User not authenticated');
    }
  }
}
