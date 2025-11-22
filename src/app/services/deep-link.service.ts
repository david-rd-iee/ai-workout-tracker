// deep-link.service.ts
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { App, URLOpenListenerEvent } from '@capacitor/app';

@Injectable({
  providedIn: 'root'
})
export class DeepLinkService {
  private router = inject(Router);

  constructor() {
    // We don't need to initialize deep links here anymore
    // since it's now handled in app.component.ts
    
    // Check for any launch URL when the app starts
    this.checkLaunchUrl();
  }

  /**
   * Check if the app was launched with a URL
   */
  private async checkLaunchUrl() {
    try {
      const result = await App.getLaunchUrl();
      if (result && result.url) {
        console.log('App launched with URL:', result.url);
        this.handleDeepLink(result.url);
      }
    } catch (error) {
      console.error('Error checking launch URL:', error);
    }
  }

  /**
   * Handle a deep link URL
   * This can be called from app.component.ts or anywhere else
   */
  public handleDeepLink(url: string) {
    console.log('Handling deep link:', url);
    
    try {
      // Parse the URL
      const urlObj = new URL(url);
      
      // Extract path components
      const pathParts = urlObj.pathname.split('/');
      console.log('Path parts:', pathParts);
      
      // Check if this is a trainer info deep link
      // Format: /app/tabs/trainer-info/{trainerId}
      if (pathParts.length >= 4 && 
          pathParts[1] === 'app' && 
          pathParts[2] === 'tabs' && 
          pathParts[3] === 'trainer-info') {
        
        const trainerId = pathParts[4];
        if (trainerId) {
          console.log('Found trainer ID in deep link:', trainerId);
          
          // Extract query parameters
          const provider = urlObj.searchParams.get('provider');
          const source = urlObj.searchParams.get('source');
          const gclid = urlObj.searchParams.get('gclid');
          
          console.log('Deep link parameters:', { provider, source, gclid });
          
          // Navigate to the trainer info page
          this.navigateToTrainer(trainerId, provider, source, gclid);
          return true;
        }
      }
      
      // If we get here, we didn't handle the deep link
      console.log('Unhandled deep link format:', url);
      return false;
    } catch (error) {
      console.error('Error handling deep link:', error);
      return false;
    }
  }
  
  /**
   * Navigate to the trainer info page
   */
  private navigateToTrainer(trainerId: string, provider: string | null, source: string | null, gclid: string | null) {
    console.log(`Navigating to trainer ${trainerId} from ${source || 'unknown'} via ${provider || 'direct'}`);
    
    // Build query params object
    const queryParams: any = {};
    if (provider) queryParams.provider = provider;
    if (source) queryParams.source = source;
    if (gclid) queryParams.gclid = gclid;
    
    // Navigate to the trainer info page
    this.router.navigate(['/app/tabs/trainer-info', trainerId], { queryParams })
      .then(success => {
        if (success) {
          console.log('Navigation successful');
        } else {
          console.error('Navigation failed');
        }
      })
      .catch(error => {
        console.error('Navigation error:', error);
      });
  }
}