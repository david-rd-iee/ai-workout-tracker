import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonTitle, IonToolbar, ModalController } from '@ionic/angular/standalone';
import { AgreementTemplate } from 'src/app/Interfaces/Agreement';
import { ServiceAgreementComponent } from 'src/app/components/agreements/service-agreement/service-agreement.component';
import { AgreementService } from 'src/app/services/agreement.service';
import { UserService } from 'src/app/services/account/user.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';

@Component({
  selector: 'app-agreement-modal',
  templateUrl: './agreement-modal.component.html',
  styleUrls: ['./agreement-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    IonButton, 
    IonButtons, 
    IonTitle, 
    IonHeader, 
    IonList, 
    IonItem, 
    IonLabel, 
    IonToolbar, 
    IonContent,
    ServiceAgreementComponent
  ]
})
export class AgreementModalComponent implements OnInit {
  @Input() clientId: string | null = null;
  @Input() clientName: string = '';

  templates: AgreementTemplate[] = [];
  selectedTemplateId: string | null = null;
  showContent: boolean = false;
  isCreatingNew: boolean = false;
  newAgreement: AgreementTemplate | null = null;
  isLoading: boolean = false;

  constructor(
    private modalCtrl: ModalController,
    private agreementService: AgreementService,
    private userService: UserService
  ) {}

  ngOnInit() {
    // Load templates from your service
    this.loadTemplates();
  }

  async loadTemplates() {
    this.isLoading = true;
    try {
      // Only get template IDs and names for the list view
      this.templates = await this.agreementService.getAgreementTemplates();
    } catch (error) {
      console.error('Error loading templates:', error);
      this.templates = [];
    } finally {
      this.isLoading = false;
    }
  }

  selectTemplate(templateId: string) {
    this.selectedTemplateId = templateId;
    this.showContent = true;
    this.isCreatingNew = false;
  }

  createNew() {
    // Initialize a new empty agreement template
    const dateCreated = new Date();
    this.newAgreement = {
      id: Date.now().toString(), // Generate a temporary ID
      name: 'New Agreement',
      agreementData: {
        services: [],
        policies: []
      },
      date_created: dateCreated,
      date_updated: dateCreated,
    };
    
    this.isCreatingNew = true;
    this.showContent = false;
  }

  saveNewAgreement(agreementData: any) {
    if (this.newAgreement) {
      // Update the new agreement with data from the service agreement component
      this.newAgreement.agreementData = agreementData;
      this.newAgreement.date_updated = new Date();
      
      // Send the new agreement to the client
      this.modalCtrl.dismiss({ 
        action: 'create',
        template: this.newAgreement 
      });
    }
  }

  async sendAgreement(data: {id: string; name: string; storagePath: string}) {
    const userInfo = this.userService.getUserInfo()() as trainerProfile;
    if (!userInfo || !userInfo.firstName || !userInfo.lastName) {
      console.error('Trainer profile not found or incomplete');
      return;
    }

    const trainerFullName = `${userInfo.firstName} ${userInfo.lastName}`;
    this.modalCtrl.dismiss({ 
      action: 'send',
      id: data.id,
      name: data.name,
      storagePath: data.storagePath,
      trainerName: trainerFullName
    });
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }
}