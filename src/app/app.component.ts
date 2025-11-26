import { Component, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonApp, IonRouterOutlet, AlertController, NavController } from '@ionic/angular/standalone';
import { register } from 'swiper/element/bundle';
import { addIcons } from 'ionicons';
import { personCircleOutline } from 'ionicons/icons';
import { Router } from '@angular/router';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AppVersionService } from './services/app-version';
import { AccountService } from './services/account/account.service';
import { UserService } from './services/account/user.service';

register();
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrl: 'app.component.scss',
  standalone: true,
  imports: [CommonModule, IonApp, IonRouterOutlet],
})
export class AppComponent {
  isCheckingVersion = true;
  needsUpdate = false;

  constructor(
    private router: Router,
    private zone: NgZone,
    private appVersionService: AppVersionService,
    private alertController: AlertController,
    private navCtrl: NavController,
    private accountService: AccountService,
    private userService: UserService
  ) {
    addIcons({
      personCircleOutline
    });
    this.initializeApp();
    this.setupAuthStateListener();
  }

  private setupAuthStateListener() {
    // Listen for auth state changes (signup, login, etc.)
    this.accountService.authStateChanges$.subscribe(async (authState) => {
      console.log('AppComponent received auth state change:', authState);
      
      // Only handle navigation if version check is complete and user just authenticated
      if (!this.isCheckingVersion && authState.isAuthenticated) {
        console.log('User authenticated after version check, handling navigation...');
        await this.handleAuthNavigation();
      }
    });
  }

  private initializeApp() {
    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      this.zone.run(() => {
        console.log('App URL opened:', event.url);
        const domain = 'atlas-2b8d0.web.app';

        if (event.url.includes(domain)) {
          try {
            // Parse the URL to get the path and query parameters
            const urlObj = new URL(event.url);
            const path = urlObj.pathname;
            
            console.log('Deep link path:', path);
            
            // Check if this is a trainer info deep link
            if (path.includes('/app/tabs/trainer-info/')) {
              // Extract the trainer ID from the URL
              const pathParts = path.split('/');
              const trainerId = pathParts[pathParts.length - 1];
              
              if (trainerId) {
                console.log('Navigating to trainer:', trainerId);
                
                // Build query params from URL search params
                const queryParams: any = {};
                urlObj.searchParams.forEach((value, key) => {
                  queryParams[key] = value;
                });
                
                // Navigate to the trainer info page with query params
                this.router.navigate(['/app/tabs/trainer-info', trainerId], { queryParams });
              } else {
                // If no trainer ID, just navigate to the path
                this.router.navigateByUrl(path);
              }
            } else {
              // For other paths, just navigate directly
              this.router.navigateByUrl(path);
            }
          } catch (error) {
            console.error('Error handling deep link:', error);
            
            // Fallback to the old method
            const pathArray = event.url.split(domain);
            const appPath = pathArray.pop();
            if (appPath) {
              console.log('Fallback navigation to:', appPath);
              this.router.navigateByUrl(appPath);
            }
          }
        }
      });
    });
    this.checkForUpdate();
  }

  private async checkForUpdate() {
    try {
      // Wait for animation to complete and add extra time (2.5s)
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      this.needsUpdate = await this.appVersionService.checkVersion();
      
      if (this.needsUpdate) {
        // Show alert for update required
        const alert = await this.alertController.create({
          header: 'Update Required',
          message: 'A new version of Atlas is available. Please update to continue using the app.',
          backdropDismiss: false,
          buttons: [
            {
              text: 'Update Now',
              handler: () => {
                this.openAppStore();
              }
            }
          ]
        });
        
        await alert.present();
      } else {
        // Version is up to date, allow app to load
        this.isCheckingVersion = false;
        
        // Check auth state and navigate appropriately
        await this.handleAuthNavigation();
      }
    } catch (error) {
      console.error('Error checking version:', error);
      // On error, allow app to load
      this.isCheckingVersion = false;
      
      // Still check auth even if version check failed
      await this.handleAuthNavigation();
    }
  }

  private async handleAuthNavigation() {
    console.log('Checking auth state after version check...');
    
    // Wait a moment for auth to initialize if needed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (this.accountService.isLoggedIn()()) {
      console.log('User is logged in, loading profile...');
      try {
        const didLoad = await this.userService.loadUserProfile();
        if (!didLoad) {
          console.log('No profile found, navigating to profile creation');
          this.navCtrl.navigateRoot('/profile-creation');
        } else {
          console.log('Profile loaded successfully, navigating to home');
          this.navCtrl.navigateRoot('/app/tabs/home');
        }
      } catch (error) {
        console.error('Error loading profile:', error);
        // this.navCtrl.navigateRoot('/login'); // Temporarily disabled for testing
      }
    } else {
      console.log('User not logged in, navigating to login');
      // this.navCtrl.navigateRoot('/login'); // Temporarily disabled for testing
    }
  }

  openAppStore() {
    const platform = Capacitor.getPlatform();
    
    if (platform === 'ios') {
      // Replace with your actual App Store ID
      // itms-apps:// opens the native App Store app
      window.location.href = 'itms-apps://itunes.apple.com/app/id6743042960';
    } else if (platform === 'android') {
      // market:// opens the native Play Store app
      window.location.href = 'market://details?id=io.atlas.app';
    }
  }
}
