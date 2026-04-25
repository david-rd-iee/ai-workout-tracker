import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Signal,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import { SafeResourceUrl, DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
  IonInput,
  IonSpinner,
} from '@ionic/angular/standalone';
import { ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  checkmarkCircle,
  createOutline,
  documentTextOutline,
  eyeOutline,
  pencilOutline,
  trashOutline,
} from 'ionicons/icons';
import { Agreement, AgreementTemplate } from 'src/app/Interfaces/Agreement';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { ServiceAgreementComponent } from 'src/app/components/agreements/service-agreement/service-agreement.component';
import { clientProfile } from 'src/app/Interfaces/Profiles/client';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { AgreementService } from 'src/app/services/agreement.service';
import { UserService } from 'src/app/services/account/user.service';

@Component({
  selector: 'app-service-agreements-page',
  standalone: true,
  templateUrl: './service-agreements.page.html',
  styleUrls: ['./service-agreements.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonIcon,
    IonInput,
    IonSpinner,
    HeaderComponent,
    ServiceAgreementComponent,
  ],
})
export class ServiceAgreementsPage implements AfterViewInit {
  @ViewChild('signatureCanvas') signatureCanvas?: ElementRef<HTMLCanvasElement>;

  private readonly agreementService = inject(AgreementService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);
  readonly user = inject(UserService).getUserInfo() as Signal<trainerProfile | clientProfile | null>;

  isLoading = true;
  isSubmittingSignature = false;
  selectedTemplateId: string | null = null;
  templates: AgreementTemplate[] = [];
  agreements: Agreement[] = [];
  selectedAgreement: Agreement | null = null;
  signerName = '';
  selectedAgreementDocumentUrl: SafeResourceUrl | null = null;
  isLoadingDocument = false;
  documentLoadError = '';

  private isDrawing = false;
  private signatureHasInk = false;

  constructor() {
    addIcons({
      checkmarkCircle,
      createOutline,
      documentTextOutline,
      eyeOutline,
      pencilOutline,
      trashOutline,
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

  ngAfterViewInit(): void {
    this.queueCanvasSetup();
  }

  ionViewWillEnter(): void {
    void this.refreshData();
  }

  get isTrainer(): boolean {
    return this.user()?.accountType === 'trainer';
  }

  get pageTitle(): string {
    return this.isTrainer ? 'Agreements & Waivers' : 'My Agreements';
  }

  get pendingAgreements(): Agreement[] {
    return this.agreements.filter((agreement) => agreement.status === 'pending');
  }

  get signedAgreements(): Agreement[] {
    return this.agreements.filter((agreement) => agreement.status !== 'pending');
  }

  openSignedAgreements(): void {
    void this.router.navigate(['/service-agreements/signed']);
  }

  continueToPayment(agreement: Agreement): void {
    if (!agreement?.id) {
      return;
    }

    void this.router.navigate(['/agreement-payment', agreement.id]);
  }

  async refreshData(): Promise<void> {
    const currentUser = this.user();
    if (!currentUser) {
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    try {
      if (currentUser.accountType === 'trainer') {
        try {
          this.templates = await this.agreementService.getAgreementTemplates();
        } catch (error) {
          console.error('Error loading agreement templates:', error);
          this.templates = [];
        }

        try {
          this.agreements = await this.agreementService.getAgreementsForRole('trainer');
        } catch (error) {
          console.error('Error loading sent agreements:', error);
          this.agreements = [];
        }
      } else {
        this.templates = [];
        this.agreements = await this.agreementService.getAgreementsForRole('client');
        if (!this.signerName) {
          this.signerName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
        }
      }

      if (this.selectedAgreement) {
        this.selectedAgreement =
          this.agreements.find((agreement) => agreement.id === this.selectedAgreement?.id) ?? null;
      }
    } finally {
      this.isLoading = false;
      this.queueCanvasSetup();
    }
  }

  startNewTemplate(): void {
    this.selectedTemplateId = 'new';
  }

  editTemplate(templateId: string): void {
    this.selectedTemplateId = templateId;
  }

  closeTemplateEditor(): void {
    this.selectedTemplateId = null;
  }

  async handleTemplateSaved(): Promise<void> {
    this.selectedTemplateId = null;
    await this.refreshData();
  }

  async deleteTemplate(event: Event, template: AgreementTemplate): Promise<void> {
    event.stopPropagation();
    if (!template?.id) {
      return;
    }

    try {
      await this.agreementService.deleteAgreementTemplate(template.id);
      if (this.selectedTemplateId === template.id) {
        this.selectedTemplateId = null;
      }
      await this.refreshData();
    } catch (error) {
      console.error('Error deleting agreement template:', error);
    }
  }

  async openAgreement(agreement: Agreement): Promise<void> {
    this.selectedAgreement = agreement;
    this.selectedAgreementDocumentUrl = null;
    this.documentLoadError = '';
    if (!this.signerName) {
      const currentUser = this.user();
      this.signerName = `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim();
    }
    this.queueCanvasSetup();
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
    this.clearSignaturePad();
  }

  startSignature(event: PointerEvent): void {
    const canvas = this.signatureCanvas?.nativeElement;
    if (!canvas || !this.selectedAgreement || this.selectedAgreement.status !== 'pending') {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const point = this.getCanvasPoint(canvas, event);
    this.isDrawing = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  drawSignature(event: PointerEvent): void {
    const canvas = this.signatureCanvas?.nativeElement;
    if (!canvas || !this.isDrawing) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const point = this.getCanvasPoint(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
    this.signatureHasInk = true;
  }

  endSignature(): void {
    this.isDrawing = false;
  }

  clearSignaturePad(): void {
    const canvas = this.signatureCanvas?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#edf3ff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#2458d8';
    context.lineWidth = 3;
    context.lineCap = 'round';
    this.signatureHasInk = false;
  }

  async submitSignature(): Promise<void> {
    if (!this.selectedAgreement || this.selectedAgreement.status !== 'pending') {
      return;
    }

    const canvas = this.signatureCanvas?.nativeElement;
    const signerName = this.signerName.trim();
    if (!canvas || !this.signatureHasInk || !signerName) {
      return;
    }

    this.isSubmittingSignature = true;
    try {
      const signedAgreementId = this.selectedAgreement.id;
      const selectedAgreementBeforeSign = this.selectedAgreement;
      await this.agreementService.signAgreement(this.selectedAgreement.id, signerName, canvas.toDataURL('image/png'));
      await this.refreshData();

      const requiresPayment = selectedAgreementBeforeSign.paymentTerms?.required === true;
      const paymentStatus = String(selectedAgreementBeforeSign.paymentStatus || '').toLowerCase();
      const alreadySettled = paymentStatus === 'paid' || paymentStatus === 'active';
      if (requiresPayment && !alreadySettled) {
        await this.router.navigate(['/agreement-payment', signedAgreementId]);
      }
    } catch (error) {
      console.error('Error signing agreement:', error);
      await this.presentSignErrorToast(error);
    } finally {
      this.isSubmittingSignature = false;
    }
  }

  private async presentSignErrorToast(error: unknown): Promise<void> {
    const errorCode = String((error as { code?: string })?.code || '').toLowerCase();
    const message = errorCode.includes('permission-denied') || errorCode.includes('unauthorized')
      ? 'You do not have permission to sign this agreement right now.'
      : 'Could not sign this agreement. Please try again.';

    const toast = await this.toastController.create({
      message,
      duration: 3200,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }

  private queueCanvasSetup(): void {
    requestAnimationFrame(() => {
      const canvas = this.signatureCanvas?.nativeElement;
      if (!canvas || !this.selectedAgreement || this.selectedAgreement.status !== 'pending') {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width || 320));
      canvas.height = 180;
      this.clearSignaturePad();
    });
  }

  private toSafeDocumentUrl(url: string | null | undefined): string | null {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
      return null;
    }

    try {
      const parsed = new URL(normalizedUrl, window.location.origin);
      const isSameOrigin = parsed.origin === window.location.origin;
      const isTrustedStorageHost =
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'firebasestorage.googleapis.com' ||
          parsed.hostname === 'storage.googleapis.com');

      return isSameOrigin || isTrustedStorageHost ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  private getCanvasPoint(canvas: HTMLCanvasElement, event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }
}
