import { Component, Input, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Preferences } from '@capacitor/preferences';
import { Platform } from '@ionic/angular/standalone';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonSpinner,
  IonItem,
  IonInput,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonIcon,
  ModalController,
  AlertController,
  LoadingController
} from '@ionic/angular/standalone';
import { Storage, getDownloadURL, ref } from '@angular/fire/storage';
import { AgreementService } from 'src/app/services/agreement.service';
import { UserService } from 'src/app/services/account/user.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-pdf-signing-modal',
  templateUrl: './pdf-signing-modal.component.html',
  styleUrls: ['./pdf-signing-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonSpinner,
    IonItem,
    IonInput,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent
  ]
})
export class PdfSigningModalComponent implements OnInit {
  @Input() storagePath: string = '';
  @Input() agreementId: string = '';
  
  pdfUrl: SafeResourceUrl | null = null;
  pdfViewerUrl: SafeResourceUrl | null = null;
  rawPdfUrl: string = '';
  loading: boolean = true;
  error: string | null = null;
  fullName: string = '';
  isSignedByTrainer: boolean = false;
  isSignedByClient: boolean = false;
  signerType: 'trainer' | 'client' = 'client';
  
  constructor(
    private modalCtrl: ModalController,
    private storage: Storage,
    private sanitizer: DomSanitizer,
    private alertController: AlertController,
    private agreementService: AgreementService,
    private userService: UserService,
    private router: Router,
    private platform: Platform
  ) {
    effect(() => {
      const userProfile = this.userService.getUserInfo()();
      if (userProfile) {
      console.log('User profile:', userProfile?.accountType);
        this.signerType = userProfile.accountType === 'trainer' ? 'trainer' : 'client';
      }
    });
  }

  setPdfViewerUrl(): void {
    if (!this.rawPdfUrl) {
      this.pdfViewerUrl = this.sanitizer.bypassSecurityTrustResourceUrl('');
      return;
    }
    
    // Use Google Docs Viewer for better mobile compatibility and multi-page viewing
    const encodedUrl = encodeURIComponent(this.rawPdfUrl);
    const viewerUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
    
    this.pdfViewerUrl = this.sanitizer.bypassSecurityTrustResourceUrl(viewerUrl);
  }

  async ngOnInit() {
    if (!this.storagePath) {
      this.error = 'No storage path provided';
      this.loading = false;
      return;
    }

    try {
      // Load agreement to check signatures
      const agreement = await this.agreementService.getAgreementById(this.agreementId);
      if (agreement && agreement.signatures) {
        if (agreement.signatures.trainer) {
          this.isSignedByTrainer = true;
        }
        
        if (agreement.signatures.client) {
          this.isSignedByClient = true;
          this.fullName = agreement.signatures.client.name || '';
        }
      }

      // Load PDF
      const storageRef = ref(this.storage, this.storagePath);
      const url = await getDownloadURL(storageRef);
      this.rawPdfUrl = url;
      this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      this.setPdfViewerUrl(); // Set the viewer URL once
      console.log('PDF URL retrieved from Firebase Storage');
      
    } catch (err) {
      console.error('Error loading PDF from Firebase Storage:', err);
      this.error = 'Failed to load PDF';
    } finally {
      this.loading = false;
    }
  }

  dismiss(result?: { signed: boolean; fullName: string; signerType: 'trainer' | 'client'; bothPartiesSigned: boolean }) {
    this.modalCtrl.dismiss(result);
  }

  async signDocument(form: NgForm) {
    if (!form.valid) return;

    const alert = await this.alertController.create({
      header: 'Sign Document',
      message: `By clicking Sign, you confirm that you have reviewed and agree to the terms of this document.`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Sign',
          handler: () => this.handleSignature()
        }
      ]
    });

    await alert.present();
  }

  private async handleSignature() {
    try {
      this.loading = true;
      this.error = null;

      // For trainer signatures, save immediately
      if (this.signerType === 'trainer') {
        // Save signature to database
        const signatures = await this.agreementService.saveSignature(
          this.agreementId,
          this.fullName,
          this.signerType
        );
        
        // Dismiss the modal after saving trainer signature
        await this.dismiss({
          signed: true,
          fullName: this.fullName,
          signerType: this.signerType,
          bothPartiesSigned: false
        });
        return;
      }
      
      // For client signatures, don't save yet - redirect to payment first
      if (this.signerType === 'client') {
        try {
          const signatureData = {
            agreementId: this.agreementId,
            fullName: this.fullName,
            signerType: this.signerType
          };

          // Store in localStorage/Preferences for app state
          if (this.platform.is('ios')) {
            await Preferences.set({
              key: 'pendingSignature',
              value: JSON.stringify(signatureData)
            });
          } else {
            localStorage.setItem('pendingSignature', JSON.stringify(signatureData));
          }

          // ALSO store in Firestore so webhook can access it
          await this.agreementService.savePendingClientSignature(
            this.agreementId,
            this.fullName
          );
          
          // Dismiss the modal before redirecting to payment
          await this.dismiss({
            signed: false, // Not actually signed yet, will be signed after payment
            fullName: this.fullName,
            signerType: this.signerType,
            bothPartiesSigned: false
          });
          
          // Redirect to payment page
          this.router.navigateByUrl(`/payment/${this.agreementId}`);
          return;
        } catch (error) {
          console.error('Error dismissing modal:', error);
        }
      }
      
      // Close the modal (only for trainer or if there was an error for client)
      this.dismiss({
        signed: true,
        fullName: this.fullName,
        signerType: this.signerType,
        bothPartiesSigned: false
      });
    } catch (err) {
      console.error('Error signing document:', err);
      this.error = 'Failed to sign document';
    } finally {
      this.loading = false;
    }
  }
}
