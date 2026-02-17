import { Injectable, signal, Signal, computed } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { credentials } from '../../interfaces/profiles/credentials';
type Credentials = credentials;
import { NavController, Platform } from '@ionic/angular';
import { BehaviorSubject, Subject } from 'rxjs';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
// Import for Capacitor plugins
import { registerPlugin } from '@capacitor/core';

// Define the interface for the Apple Sign In plugin
interface AppleSignInPlugin {
  Authorize(): Promise<{
    response?: {
      identityToken: string;
      email?: string;
      familyName?: string;
      givenName?: string;
      authorizationCode?: string;
    };
    identityToken?: string;
    email?: string;
    user?: string;
  }>;
}

// Register the Apple Sign In plugin
const SignInWithApple = registerPlugin<AppleSignInPlugin>('SignInWithApple');

@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private credentials = signal<Credentials>({ uid: '', email: '' });
  private authInitialized = signal(false);
  private isAuthenticated = computed(() => !!this.credentials().uid);
  
  // Event system for authentication state changes
  private authStateChange$ = new Subject<{ user: any; isAuthenticated: boolean }>();
  
  // Public observable for other services to listen to auth changes
  public authStateChanges$ = this.authStateChange$.asObservable();

  constructor(
    private afAuth: AngularFireAuth,
    private navCtrl: NavController,
    private router: Router,
    private platform: Platform,
    private firestore: Firestore
  ) {
    this.initializeAuth();
  }

  private async ensureUsersDocument(uid: string, email: string | null): Promise<void> {
    const userRef = doc(this.firestore, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      return;
    }

    await setDoc(userRef, {
      userId: uid,
      email: email ?? '',
      name: 'New User',
      isPT: false,
      ptUID: '',
      groups: [],
      profileImage: '',
      profilepic: '',
      created_at: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  private async initializeAuth() {
    try {
      await this.afAuth.setPersistence('local');

      this.afAuth.authState.subscribe(async (user) => {
        if (user && user.uid) {
          console.log('Auth state changed - user authenticated:', user.uid);
          this.credentials.set({ uid: user.uid, email: user.email || '' });
          
          // Emit authentication state change event
          this.authStateChange$.next({ user, isAuthenticated: true });
          
          console.log('User authenticated, emitted auth state change event');
          // Don't navigate here - let the component/service that handles profile loading do the navigation
        } else {
          this.credentials.set({ uid: '', email: '' });
          // this.navCtrl.navigateRoot('/login'); // Temporarily disabled for testing
        }
        this.authInitialized.set(true);
      });
    } catch (error) {
      console.error('Error initializing auth:', error);
      this.authInitialized.set(true);
    }
  }

  isAuthReady(): Signal<boolean> {
    return this.authInitialized.asReadonly();
  }

  isLoggedIn(): Signal<boolean> {
    return this.isAuthenticated;
  }

  getCredentials(): Signal<Credentials> {
    return this.credentials.asReadonly();
  }

  // Update the signup method
  async signup(email: string, password: string): Promise<boolean> {
    try {
      const userCredential = await this.afAuth.createUserWithEmailAndPassword(email, password);
      if (!userCredential.user) {
        return false;
      }
      await this.ensureUsersDocument(userCredential.user.uid, userCredential.user.email ?? email);
      this.credentials.set({ uid: userCredential.user.uid, email: email });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Update the login method
  async login(email: string, password: string): Promise<boolean> {
    try {

      const userCredential = await this.afAuth.signInWithEmailAndPassword(email, password);
      console.log('User credential:', userCredential);
      if (userCredential.user === null) {
        console.log('Login error', userCredential.user);  
        return false;
      }

      this.credentials.set({ uid: userCredential.user.uid, email: email });
      return true;
    } catch (e) {
      console.log('Login error', e);
      return false;
    }
  }

  // Update the logout method
  async logout() {
    await this.afAuth.signOut();
    // Force reload all routes by navigating to login
    await this.router.navigate(['/login'], {
      onSameUrlNavigation: 'reload',
      replaceUrl: true
    });

    // Optional: Refresh the page to clear all states
    window.location.reload();
    this.credentials.set({ uid: '', email: '' });
  }

  // Change password method
  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get current user
      const user = await this.afAuth.currentUser;
      
      if (!user) {
        return { success: false, message: 'No user is currently logged in' };
      }
      
      // Get current email
      const email = user.email;
      
      if (!email) {
        return { success: false, message: 'User email not found' };
      }
      
      // Re-authenticate user before changing password
      try {
        const credential = firebase.auth.EmailAuthProvider.credential(email, currentPassword);
        await user.reauthenticateWithCredential(credential);
      } catch (error) {
        console.error('Re-authentication failed:', error);
        return { success: false, message: 'Current password is incorrect' };
      }
      
      // Change password
      await user.updatePassword(newPassword);
      return { success: true, message: 'Password updated successfully' };
    } catch (error: any) {
      console.error('Password change error:', error);
      return { 
        success: false, 
        message: error.message || 'Failed to change password. Please try again.'
      };
    }
  }

  // Sign in with Apple
  async signInWithApple(): Promise<boolean> {
    try {
      // Only proceed if on iOS platform
      if (!this.platform.is('ios')) {
        console.log('Apple Sign In is only available on iOS devices');
        return false;
      }

      // Use the Capacitor Apple Login plugin
      const result = await SignInWithApple.Authorize();
      console.log('Apple Sign In raw result:', result);
      
      // The plugin returns data in a 'response' object
      const appleResponse = result.response || result;
      
      if (!appleResponse || !appleResponse.identityToken) {
        console.log('Apple Sign In failed: No identity token');
        return false;
      }

      // Create a credential for Firebase Auth
      const oauthProvider = new firebase.auth.OAuthProvider('apple.com');
      const credential = oauthProvider.credential({
        idToken: appleResponse.identityToken
      });

      // Sign in with the credential
      const userCredential = await this.afAuth.signInWithCredential(credential);
      
      if (!userCredential.user) {
        console.log('Apple Sign In failed: No user returned');
        return false;
      }

      // Set the credentials
      const email = userCredential.user.email || appleResponse.email || '';
      await this.ensureUsersDocument(userCredential.user.uid, email);
      this.credentials.set({ uid: userCredential.user.uid, email: email });
      
      console.log('Apple Sign In successful', userCredential.user);
      return true;
    } catch (error) {
      console.error('Apple Sign In error:', error);
      return false;
    }
  }
}
