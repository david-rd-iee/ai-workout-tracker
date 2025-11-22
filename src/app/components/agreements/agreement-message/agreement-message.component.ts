import { Component, Input, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonCard, IonCardHeader, IonCardContent, IonButton, ModalController } from '@ionic/angular/standalone';
import { Agreement, AgreementTemplate } from 'src/app/Interfaces/Agreement';
import { AgreementService } from 'src/app/services/agreement.service';
import { PdfSigningModalComponent } from '../pdf-signing-modal/pdf-signing-modal.component';
import { UserService } from 'src/app/services/account/user.service';

@Component({
  selector: 'app-agreement-message',
  templateUrl: './agreement-message.component.html',
  styleUrls: ['./agreement-message.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonCard,
    IonCardHeader,
    IonCardContent,
    IonButton
  ],
  providers: [
    UserService
  ]
})
export class AgreementMessageComponent implements OnInit {
  @Input() agreementId: string = '';
  userType: 'trainer' | 'client' = 'client';
  agreement?: Agreement;

  constructor(
    private agreementService: AgreementService,
    private modalCtrl: ModalController,
    private userService: UserService
  ) {
    effect(() => {
      const userProfile = this.userService.getUserInfo()();
      if (userProfile) {
        this.userType = userProfile.accountType === 'trainer' ? 'trainer' : 'client';
      }
    });
  }

  ngOnInit() {
    this.loadAgreement();
  }

  private async loadAgreement() {
    if (this.agreementId) {
      const agreement = await this.agreementService.getAgreementById(this.agreementId);
      if (agreement) {
        this.agreement = agreement;
      }
    }
  }

  async viewAgreement() {
    if (!this.agreement?.agreementStoragePath) {
      console.error('No storage path found for this agreement');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: PdfSigningModalComponent,
      componentProps: {
        storagePath: this.agreement.agreementStoragePath,
        agreementId: this.agreementId,
        signerType: this.userType
      }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.signed) {
      // Refresh the agreement data
      await this.loadAgreement();
      console.log('Agreement signed successfully');
    }
  }

}
