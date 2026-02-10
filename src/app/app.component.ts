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
    console.log('[AppComponent] ngOnInit');

    if (!environment.production) {
      console.log('[AppComponent] Running dev seed...');
      try {
        await this.devSeedService.ensureDevUserAndSeed();
        console.log('[AppComponent] Dev seed finished.');
      } catch (err) {
        console.error('[AppComponent] Dev seed failed:', err);
      }
    } else {
      console.log('[AppComponent] Skipping dev seed (production env).');
    }
  }
}
