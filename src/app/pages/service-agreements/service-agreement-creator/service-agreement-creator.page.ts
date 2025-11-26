import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  IonButton, 
  IonContent, 
  IonInput, 
  IonToolbar, 
  IonHeader, 
  IonTitle, 
  IonButtons, 
  IonIcon,
  ModalController 
} from '@ionic/angular/standalone';
import { HeaderComponent } from '../../../components/header/header.component';
import { ServiceAgreementComponent } from 'src/app/components/agreements/service-agreement/service-agreement.component';
import { AgreementService } from 'src/app/services/agreement.service';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

@Component({
  selector: 'app-service-agreement-creator',
  templateUrl: './service-agreement-creator.page.html',
  styleUrls: ['./service-agreement-creator.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonInput,
    IonButton,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonIcon,
    ServiceAgreementComponent
  ]
})
export class ServiceAgreementCreatorPage implements OnInit {
  @Input() templateId: string = 'new';
  @Input() isViewMode: boolean = false;
  agreementName: string = '';
  pageTitle: string = 'Service Agreement';

  constructor(
    public modalController: ModalController,
    private agreementService: AgreementService
  ) {
    // Initialize icons
    addIcons({
      closeOutline
    });
  }

  async ngOnInit() {
    // If we're viewing an existing template, load its data
    if (this.templateId && this.templateId !== 'new') {
      try {
        const template = await this.agreementService.getTemplateById(this.templateId);
        if (template) {
          this.agreementName = template.name;
          this.pageTitle = this.isViewMode ? 'View Agreement Template' : 'Edit Agreement Template';
        }
      } catch (error) {
        console.error('Error loading template:', error);
      }
    } else {
      this.pageTitle = 'Create Agreement Template';
    }
  }

  onSave() {
    // Handle any additional logic after saving
    console.log('Agreement saved successfully');
    
    // If we're in a modal, close it and indicate refresh is needed
    if (this.modalController) {
      this.modalController.dismiss({
        refresh: true
      });
    }
  }

  closeModal() {
    if (this.modalController) {
      this.modalController.dismiss();
    }
  }
}
