import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonInput, IonHeader, IonTitle, IonToolbar, IonItem, IonLabel, IonButton, IonIcon } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { AccountService } from 'src/app/services/account/account.service';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';

@Component({
  selector: 'app-sign-up',
  templateUrl: './sign-up.page.html',
  styleUrls: ['./sign-up.page.scss'],
  standalone: true,
  imports: [IonContent, IonHeader, RouterLink, CommonModule, IonItem, IonInput, FormsModule, IonButton, IonIcon, IonToolbar]
})
export class SignUpPage implements OnInit {
  email: string = '';
  password: string = '';
  confirmPassword: string = '';
  userData = {
    username: '',
    password: ''
  }
  user_token = '';
  isLoggedIn = false;
  isIOS = false;

  // Getter to check if passwords match
  get passwordMismatch(): boolean {
    return this.password !== this.confirmPassword && this.confirmPassword.length > 0;
  }
    
  constructor(
    private accountService: AccountService,
    private platform: Platform
  ) { 
    // Add Apple logo icon
    addIcons({ 'logo-apple': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" class="ionicon" viewBox="0 0 512 512"><path d="M349.13 136.86c-40.32 0-57.36 19.24-85.44 19.24-28.79 0-50.75-19.1-85.69-19.1-34.2 0-70.67 20.88-93.83 56.45-32.52 50.16-27 144.63 25.67 225.11 18.84 28.81 44 61.12 77 61.47h.6c28.68 0 37.2-18.78 76.67-19h.6c38.88 0 46.68 18.89 75.24 18.89h.6c33-.35 59.51-36.15 78.35-64.85 13.56-20.64 18.6-31 29-54.35-76.19-28.92-88.43-136.93-13.08-178.34-23-28.8-55.32-45.48-85.79-45.48z"/><path d="M340.25 32c-24 1.63-52 16.91-68.4 36.86-14.88 18.08-27.12 44.9-22.32 70.91h1.92c25.56 0 51.72-15.39 67-35.11 14.72-18.77 25.88-45.37 21.8-72.66z"/></svg>' })
  }

  ngOnInit(){
    // Check if the device is iOS
    this.isIOS = this.platform.is('ios');
    console.log('Is iOS device:', this.isIOS);
    
    // this.accountService.checkKeyChain().then(value => {
    //   console.log('Got value', value)
    //   if(JSON.parse(value)) {
    //     this.accountService.loadProfile();
    //     this.navCtrl.navigateRoot('/tabs/home');
    //   }
    // })
    // .catch(err => console.error('Error getting', err));
  }

  async onSignupSubmit() {
    console.log('signup submitted', this.email, this.password);
    if(await this.accountService.signup(this.email, this.password)){
      // Don't navigate immediately - let UserService handle navigation based on profile state
      console.log('Signup successful, UserService will handle navigation');
    };
  }

  signUpWithGoogle() {
    console.log('Sign up with Google clicked');
    // Implement Google login logic here
  }

  async signUpWithApple() {
    console.log('Sign up with Apple clicked');
    
    try {
      const success = await this.accountService.signInWithApple();
      
      if (success) {
        // Don't navigate immediately - let UserService handle navigation based on profile state
        console.log('Apple signup successful, UserService will handle navigation');
      } else {
        const errorMessage = document.createElement('p');
        errorMessage.textContent = 'Failed to sign up with Apple';
        errorMessage.style.color = 'red';
        const signupForm = document.querySelector('form');
        signupForm?.appendChild(errorMessage);
      }
    } catch (error) {
      console.error('Apple sign up error:', error);
      const errorMessage = document.createElement('p');
      errorMessage.textContent = 'An error occurred during Apple sign up';
      errorMessage.style.color = 'red';
      const signupForm = document.querySelector('form');
      signupForm?.appendChild(errorMessage);
    }
  }
}
