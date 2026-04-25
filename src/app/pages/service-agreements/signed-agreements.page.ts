import { CommonModule } from '@angular/common';
import { Component, Signal, effect, inject } from '@angular/core';
import { SafeResourceUrl, DomSanitizer } from '@angular/platform-browser';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { documentTextOutline, eyeOutline } from 'ionicons/icons';
import { Agreement } from 'src/app/Interfaces/Agreement';
import { clientProfile } from 'src/app/Interfaces/Profiles/client';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { AgreementService } from 'src/app/services/agreement.service';
import { UserService } from 'src/app/services/account/user.service';

@Component({
  selector: 'app-signed-agreements-page',
  standalone: true,
  templateUrl: './signed-agreements.page.html',
  styleUrls: ['./signed-agreements.page.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class SignedAgreementsPage {
  private readonly agreementService = inject(AgreementService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly user = inject(UserService).getUserInfo() as Signal<trainerProfile | clientProfile | null>;

  isLoading = true;
  agreements: Agreement[] = [];
  selectedAgreement: Agreement | null = null;
  selectedAgreementDocumentUrl: SafeResourceUrl | null = null;
  isLoadingDocument = false;
  documentLoadError = '';

  constructor() {
    addIcons({
      documentTextOutline,
      eyeOutline,
    });

    void this.refreshData();

    effect(() => {
      const currentUser = this.user();
      if (!currentUser) {
        return;
      }

      void this.refreshData();
    });
  }

  ionViewWillEnter(): void {
    void this.refreshData();
  }

  get isTrainer(): boolean {
    return this.user()?.accountType === 'trainer';
  }

  get signedAgreements(): Agreement[] {
    return this.agreements.filter((agreement) => agreement.status !== 'pending');
  }

  async refreshData(): Promise<void> {
    const currentUser = this.user();
    if (!currentUser) {
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    try {
      const role = currentUser.accountType === 'trainer' ? 'trainer' : 'client';
      this.agreements = await this.agreementService.getAgreementsForRole(role);

      if (this.selectedAgreement) {
        this.selectedAgreement =
          this.agreements.find((agreement) => agreement.id === this.selectedAgreement?.id) ?? null;
      }
    } finally {
      this.isLoading = false;
    }
  }

  async openAgreement(agreement: Agreement): Promise<void> {
    this.selectedAgreement = agreement;
    this.selectedAgreementDocumentUrl = null;
    this.documentLoadError = '';
    await this.openAgreementPdf(agreement);
  }

  async openAgreementPdf(agreement: Agreement): Promise<void> {
    this.isLoadingDocument = true;
    this.documentLoadError = '';
    try {
      const downloadUrl = await this.agreementService.resolveAgreementDownloadUrl(
        this.agreementService.getAgreementDocumentPath(agreement)
      );
      const safeDocumentUrl = this.toSafeDocumentUrl(downloadUrl);
      if (!safeDocumentUrl) {
        throw new Error('Unable to load this agreement document.');
      }
      this.selectedAgreementDocumentUrl =
        this.sanitizer.bypassSecurityTrustResourceUrl(safeDocumentUrl);
    } catch (error) {
      console.error('Error loading agreement document inline:', error);
      this.documentLoadError = 'This document could not be loaded in-app right now.';
    } finally {
      this.isLoadingDocument = false;
    }
  }

  async openAgreementInBrowser(agreement: Agreement): Promise<void> {
    const downloadUrl = await this.agreementService.resolveAgreementDownloadUrl(
      this.agreementService.getAgreementDocumentPath(agreement)
    );
    const safeDocumentUrl = this.toSafeDocumentUrl(downloadUrl);
    if (safeDocumentUrl) {
      window.open(safeDocumentUrl, '_blank', 'noopener');
    }
  }

  clearSelectedAgreement(): void {
    this.selectedAgreement = null;
    this.selectedAgreementDocumentUrl = null;
    this.documentLoadError = '';
    this.isLoadingDocument = false;
  }

  private toSafeDocumentUrl(url: string): string | null {
    const trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) {
      return null;
    }
    try {
      const parsed = new URL(trimmedUrl);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol === 'https:' || protocol === 'http:') {
        return parsed.toString();
      }
      return null;
    } catch {
      return null;
    }
  }
}
