import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonContent, IonFab, IonFabButton, IonIcon, IonItem, IonItemOption, IonItemOptions, IonItemSliding, IonLabel, IonList, IonModal, IonSpinner, ModalController, ToastController } from '@ionic/angular';
import { HeaderComponent } from '../../components/header/header.component';
import { AgreementService } from '../../services/agreement.service';
import { ServiceAgreementCreatorPage } from './service-agreement-creator/service-agreement-creator.page';
import { addIcons } from 'ionicons';
import { add, trash, document, documentOutline } from 'ionicons/icons';

@Component({
  selector: 'app-service-agreements',
  templateUrl: './service-agreements.page.html',
  styleUrls: ['./service-agreements.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonButton,
    IonFab,
    IonFabButton,
    IonIcon,
    IonModal,
    IonSpinner,
    HeaderComponent,
    ServiceAgreementCreatorPage
  ]
})
export class ServiceAgreementsPage implements OnInit {
  templates: any[] = [];
  isLoading = true;
  isModalOpen = false;

  constructor(
    private agreementService: AgreementService,
    private modalController: ModalController,
    private toastController: ToastController
  ) {
    addIcons({
      add,
      trash,
      document,
      documentOutline
    });
  }

  ngOnInit() {
    this.loadTemplates();
  }

  async loadTemplates() {
    this.isLoading = true;
    try {
      this.templates = await this.agreementService.getTemplates();
      
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      this.isLoading = false;
    }
  }

 

  async openCreator() {
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
    // Reload templates after closing the modal to show any new templates
    this.loadTemplates();
  }

  async deleteTemplate(templateId: string) {
    try {
      await this.agreementService.deleteTemplate(templateId);
      // Remove the template from the local array
      this.templates = this.templates.filter(template => template.id !== templateId);
      
      const toast = await this.toastController.create({
        message: 'Template deleted successfully',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      console.error('Error deleting template:', error);
      
      const toast = await this.toastController.create({
        message: 'Failed to delete template',
        duration: 2000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  async viewTemplate(templateId: string) {
    // Create a modal to view the template (don't set isModalOpen flag)
    const modal = await this.modalController.create({
      component: ServiceAgreementCreatorPage,
      componentProps: {
        templateId: templateId,
        isViewMode: true
      },
      cssClass: 'full-screen-modal'
    });
    
    await modal.present();
    
    // Handle modal dismiss
    const { data } = await modal.onDidDismiss();
    if (data?.refresh) {
      // Reload templates if changes were made
      this.loadTemplates();
    }
  }
}
