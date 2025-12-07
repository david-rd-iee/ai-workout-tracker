import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { 
  IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent, 
  IonList, IonItem, IonLabel, IonButton, ModalController, 
  ToastController, ToastOptions } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { AccountService } from '../../../services/account/account.service';
import { UserService } from '../../../services/account/user.service';
import { HeaderComponent } from '../../../components/header/header.component';
import { documentTextOutline, peopleOutline, walletOutline, logOutOutline } from 'ionicons/icons';
import { TrainerProfile } from '../../../interfaces/profiles/trainer';
import { ClientProfile } from '../../../interfaces/profiles/client';
import { PasswordChangeModalComponent } from '../../../components/password-change-modal/password-change-modal.component';
@Component({
  selector: 'app-client-account',
  templateUrl: './client-account.page.html',
  styleUrls: ['./client-account.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    HeaderComponent,
  ]
})
export class ClientAccountPage implements OnInit {
  // Default user data for demonstration
  user = signal<ClientProfile>({
    uid: '12345',
    email: 'user@example.com',
    accountType: 'client',
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'John Doe',
    photoURL: 'https://ionicframework.com/docs/img/demos/avatar.svg',
    unreadMessageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  constructor(
    private router: Router,
    private accountService: AccountService,
    private userService: UserService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController
  ) { 
    // Add the icons to the component
    addIcons({ documentTextOutline, peopleOutline, walletOutline, logOutOutline });
    // Uncomment this in production to use real user data
    // this.user = this.userService.getUserInfo();
  }

  async ngOnInit() {
    // In a real app, you would load user data here
    try {
      // const userData = await this.userService.getUserInfo().toPromise();
      // if (userData) {
      //   this.user = userData;
      // }
    } catch (error) {
      console.error('Error loading user data:', error);
      this.showToast('Error loading account information');
    }
  }

  async openPasswordChangeModal() {
    try {
      const modal = await this.modalCtrl.create({
        component: PasswordChangeModalComponent
      });
      
      await modal.present();
      
      const { data } = await modal.onWillDismiss();
      if (data?.passwordChanged) {
        await this.showToast('Password changed successfully', 'success');
      }
    } catch (error) {
      console.error('Error in password change modal:', error);
      await this.showToast('Error changing password', 'danger');
    }
  }

  async logout() {
    try {
      await this.accountService.logout();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error during logout:', error);
      this.showToast('Error during logout', 'danger');
    }
  }

  private async showToast(message: string, color: string = 'dark') {
    const options: ToastOptions = {
      message,
      duration: 3000,
      position: 'bottom',
      color,
      buttons: [{
        icon: 'close',
        role: 'cancel'
      }]
    };
    
    const toast = await this.toastCtrl.create(options);
    await toast.present();
  }
}
