import { Component, OnInit, Signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AsyncPipe, CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { IonHeader, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonIcon, IonButton, IonListHeader, ModalController, ToastController } from '@ionic/angular/standalone';
import { AccountService } from '../../../services/account/account.service';
import { UserService } from '../../../services/account/user.service';
import { HeaderComponent } from '../../../components/header/header.component';
import { documentTextOutline, peopleOutline, walletOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { trainerProfile } from 'src/app/Interfaces/Profiles/trainer';
import { clientProfile } from 'src/app/Interfaces/Profiles/client';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { PasswordChangeModalComponent } from '../../../components/password-change-modal/password-change-modal.component';

@Component({
  selector: 'app-account',
  templateUrl: './trainer-account.page.html',
  styleUrls: ['./trainer-account.page.scss'],
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
    IonIcon,
    IonButton,
    IonListHeader,
    HeaderComponent,
  ]
})
export class AccountPage implements OnInit {
  user: Signal<trainerProfile | clientProfile | null>;
  ROUTE_PATHS = ROUTE_PATHS;

  constructor(
    private accountService: AccountService,
    private userService: UserService,
    private router: Router,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController
  ) {
    this.user = this.userService.getUserInfo();
    addIcons({
      documentTextOutline,
      peopleOutline,
      walletOutline
    });
  }

  ngOnInit() {}

  async logout() {
    await this.accountService.logout();
    this.router.navigate(['/login']);
  }

  async openPasswordChangeModal() {
    const modal = await this.modalCtrl.create({
      component: PasswordChangeModalComponent
    });
    
    await modal.present();
    
    const { data } = await modal.onWillDismiss();
    
    // If password was successfully changed (data will be true)
    if (data) {
      const toast = await this.toastCtrl.create({
        message: 'Password changed successfully',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    }
  }
}