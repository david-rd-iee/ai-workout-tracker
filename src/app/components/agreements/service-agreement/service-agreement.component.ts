import { ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output, Renderer2, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonCheckbox, IonContent, IonGrid, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonRow, IonTitle, IonToolbar, LoadingController, ToastController } from '@ionic/angular/standalone';
import html2pdf from 'html2pdf.js';
import { addIcons } from 'ionicons';
import { add, chevronDownOutline, chevronUp, chevronUpOutline, informationCircleOutline, remove } from 'ionicons/icons';
import { TruncatePipe } from 'src/app/pipes/truncate.pipe';
import { AgreementService } from 'src/app/services/agreement.service';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { policy, service } from 'src/app/Interfaces/Agreement';
import { UserService } from 'src/app/services/account/user.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { Http } from '@capacitor-community/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { AutocorrectDirective } from 'src/app/directives/autocorrect.directive';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-service-agreement',
  templateUrl: './service-agreement.component.html',
  styleUrls: ['./service-agreement.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonCheckbox,
    IonInput,
    IonIcon,
    IonLabel,
    TruncatePipe,
    AutocorrectDirective
  ]
})
export class ServiceAgreementComponent implements OnInit {
  @Input() templateId: string | null = null;
  @Input() agreementName: string = '';
  
  @Output() onSave = new EventEmitter<any>();
  @Output() onSend = new EventEmitter<{ id: string; name: string; storagePath: string }>();
  @Input() mode: 'template' | 'client' = 'template'; // Default to template mode
  @Input() clientId: string | null = null; // Add clientId for client mode

  isLoading: boolean = false;
  dsiclamermsg = 'By agreeing to these terms, the Client acknowledges the inherent risks of physical activity and confirms that they have disclosed any medical conditions that may impact their ability to exercise safely. The Client also agrees to inform the Trainer of any health changes and understands that all personal health information will remain confidential. Additionally, the Client agrees not to share or distribute the Trainer\'s intellectual property, including training materials or resources, without prior written consent. The Trainer will ensure a safe training environment, provide evidence-based guidance tailored to the Client\'s goals, and maintain professional standards. Any changes to this agreement must be made through the Atlas App\'s messaging portal, with all communication, payments, and bookings handled through the App for security and transparency.'
  isExpanded = false;

  // Default empty service to start with
  services: service[] = [
    {
      name: '',
      selectedServiceOptions: [],
      unselectedServiceOptions: []
    }
  ];

  selectedPolicies: policy[] = [];
  policies: policy[] = [];
  recurring: boolean = false;
  constructor(
    private cdr: ChangeDetectorRef,
    private agreementService: AgreementService,
    private storage: Storage,
    private loadingController: LoadingController,
    private userService: UserService,
    private auth: Auth,
    private toastController: ToastController
  ) {
    addIcons({
      informationCircleOutline,
      chevronUpOutline,
      chevronDownOutline,
      add,
      remove
    });
    
    // Uncomment this line to force initialize the database with default options
    // Only run this once when setting up the database
    // this.initializeDatabase();
  }

  async ngOnInit() {
    console.log('Service Agreement Component initialized with template ID:', this.templateId, 'Agreement Name:', this.agreementName);
    
    this.isLoading = true;
    try {
      // Load service options and policies from database
      await this.loadOptionsFromDatabase();
      
      if (this.templateId && this.templateId !== 'new') {
        // Only load template if it's a valid template ID (not 'new')
        await this.loadTemplate();
      } else if (!this.agreementName) {
        // Only set a default name if no name was provided via input
        this.agreementName = 'New Agreement';
      }
    } catch (error) {
      console.error('Error initializing service agreement component:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async loadTemplate() {
    if (!this.templateId || this.templateId === 'new') return;

    this.isLoading = true;
    try {
      const template = await this.agreementService.getTemplateById(this.templateId);
      if (template) {
        this.agreementName = template.name;

        // Map the agreement data to your component
        if (template.agreement_data) {
          if (template.agreement_data.services) {
            this.services = template.agreement_data.services;
          }

          if (template.agreement_data.policies) {
            this.selectedPolicies = template.agreement_data.policies;
          }
        }
        
        // Load recurring field if it exists
        if ((template as any).recurring !== undefined) {
          this.recurring = (template as any).recurring;
        }
      }
    } catch (error) {
      console.error('Error loading template:', error);
    } finally {
      this.isLoading = false;
    }
  }

  info(name: string) {
    console.log(name);
  }

  /**
   * Load service options and policies from database
   */
  private async loadOptionsFromDatabase() {
    try {
      // Get service options from database
      const serviceOptions = await this.agreementService.getServiceOptions();
      
      // Initialize first service with options from database
      if (this.services.length > 0 && serviceOptions.length > 0) {
        this.services[0].unselectedServiceOptions = [...serviceOptions];
      }
      
      // Get policies from database
      const policies = await this.agreementService.getPolicyOptions();
      if (policies.length > 0) {
        this.policies = policies;
      }
      
      console.log('Loaded options from database:', { serviceOptions, policies });
    } catch (error) {
      console.error('Error loading options from database:', error);
    }
  }
  
  /**
   * Initialize the database with default service options and policies
   * This should only be called once by an admin when setting up the system
   */
  private async initializeDatabase() {
    const loading = await this.loadingController.create({
      message: 'Initializing database with default options...',
      backdropDismiss: false
    });
    await loading.present();
    
    try {
      // const success = await this.agreementService.forceInitializeDatabase();
      const success = false;
      if (success) {
        const toast = await this.toastController.create({
          message: 'Database initialized with default options',
          duration: 3000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();
        
        // Reload options from database
        await this.loadOptionsFromDatabase();
      } else {
        const toast = await this.toastController.create({
          message: 'Failed to initialize database',
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    } catch (error) {
      console.error('Error initializing database:', error);
      
      const toast = await this.toastController.create({
        message: 'Error initializing database',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  addService() {
    // Get the current service options from the first service (which should have all options loaded)
    const serviceOptions = this.services.length > 0 ? 
      [...this.services[0].unselectedServiceOptions] : [];
    
    this.services.push({
      name: '',
      selectedServiceOptions: [],
      unselectedServiceOptions: serviceOptions
    });
  }

  removeService(index: number) {
    this.services.splice(index, 1);
  }

  moveItem(fromArray: any[], toArray: any[], item: any) {
    if (!fromArray || !toArray || !item) {
      console.error('moveItem: One of the parameters is undefined', { fromArray, toArray, item });
      return;
    }

    const index = fromArray.indexOf(item);
    if (index > -1) {
      fromArray.splice(index, 1);
      toArray.push(item);
    } else {
      console.error('moveItem: Item not found in fromArray', { fromArray, item });
    }
  }

  async generatePDF(): Promise<Blob> {
    this.isExpanded = true;
    this.cdr.detectChanges();

    const content = document.getElementById('pdf-content');
    let clonedContent = content!.cloneNode(true) as HTMLElement;
    const style = document.createElement('style');
    style.innerHTML = ` 
    * { color: black !important; }
    input { color: black !important; }
    ion-input::part(native) { color: black !important; }
    ion-input::part(placeholder) { color: black !important; }
    
    /* Page break controls */
    h2, h3 { 
      page-break-after: avoid;
      break-after: avoid;
      margin-top: 15px; 
    }
    
    .services-container, .policies, div[*ngFor="let policy of selectedPolicies"] {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .keep-together {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .page-break {
      page-break-before: always;
      break-before: always;
    }
  `;
    clonedContent.appendChild(style);
    this.cdr.detectChanges();

    // Remove elements that shouldn't appear in the PDF
    const elementsToRemove = clonedContent.querySelectorAll('.removePDF');
    elementsToRemove.forEach(element => element.remove());

    // Wrap headings and their related content to keep them together
    const headings = clonedContent.querySelectorAll('h2, h3, h4');
    headings.forEach(heading => {
      const wrapper = document.createElement('div');
      wrapper.className = 'keep-together';
      heading.parentNode?.insertBefore(wrapper, heading);

      // Move the heading into the wrapper
      wrapper.appendChild(heading);

      // Move related content until the next heading into the wrapper
      let nextElement = wrapper.nextSibling;
      while (nextElement &&
        !(nextElement instanceof HTMLElement &&
          ['H2', 'H3', 'H4'].includes(nextElement.tagName))) {
        const current = nextElement;
        nextElement = nextElement.nextSibling;
        wrapper.appendChild(current);
      }
    });
    const options = {
      margin: [0.75, 0.75, 0.75, 0.75], // top, right, bottom, left margins in inches
      filename: `${this.agreementName}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false
      },
      jsPDF: {
        unit: 'in',
        format: 'letter',
        orientation: 'portrait',
        compress: true
      },
      pagebreak: {
        mode: ['avoid-all', 'css', 'legacy'],
        before: '.page-break'
      }
    };

    return new Promise((resolve, reject) => {
      html2pdf()
        .from(clonedContent)
        .set(options)
        .outputPdf('blob')
        .then((pdfBlob: Blob) => resolve(pdfBlob))
        .catch((error: any) => reject(error));
    });
  }

  /**
   * Downloads the PDF using Capacitor Filesystem API for iOS compatibility
   */
  async downloadPDF() {
    const loading = await this.loadingController.create({
      message: 'Generating PDF...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      // Generate PDF blob
      const pdfBlob = await this.generatePDF();
      const fileName = `${this.agreementName.replace(/\s+/g, '_')}.pdf`;
      
      // Convert blob to base64
      const base64Data = await this.blobToBase64(pdfBlob);
      const base64Content = base64Data.split(',')[1]; // Remove the data:application/pdf;base64, prefix
      
      if (Capacitor.isNativePlatform()) {
        // On native platforms (iOS/Android), use Filesystem API
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64Content,
          directory: Directory.Documents,
          recursive: true
        });
        
        // Show success message with the file path
        const toast = await this.toastController.create({
          message: `PDF saved to Documents/${fileName}`,
          duration: 3000,
          position: 'bottom'
        });
        await toast.present();
        
        console.log('File written successfully:', result.uri);
      } else {
        // On web, use the traditional approach
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error generating or saving PDF:', error);
      const toast = await this.toastController.create({
        message: 'Failed to save PDF. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }
  toggleExpand() {
    this.isExpanded = !this.isExpanded;
  }

  async saveToFirestore() {
    const loading = await this.loadingController.create({
      message: 'Saving agreement template...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      console.log('Saving agreement template:', this.agreementName, this.services, this.selectedPolicies, this.policies);
      // Save to Firestore
      await this.agreementService.saveAgreementTemplate(
        this.agreementName,
        this.services,
        this.selectedPolicies,
        this.recurring,
        this.templateId || undefined
      );

      const agreementData = {
        name: this.agreementName,
        agreement_data: {
          services: this.services,
          policies: this.selectedPolicies
        },
        recurring: this.recurring
      };

      this.onSave.emit(agreementData);
      
      // Show success message
      const toast = await this.toastController.create({
        message: 'Agreement template saved successfully',
        duration: 2000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();
    } catch (error) {
      console.error('Error saving agreement template:', error);
      
      // Show error message
      const toast = await this.toastController.create({
        message: 'Failed to save agreement template',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Convert a Blob to base64 string
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async sendAgreement() {
    if (!this.clientId) {
      console.error('Client ID is required to send an agreement');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Generating and sending agreement...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      // Get trainer's name from profile
      const userInfo = this.userService.getUserInfo()() as trainerProfile;
      if (!userInfo || !userInfo.firstName || !userInfo.lastName) {
        console.error('Trainer profile not found or incomplete');
        return;
      }
      const trainerName = `${userInfo.firstName} ${userInfo.lastName}`;

      // Generate PDF blob
      const pdfBlob = await this.generatePDF();
      
      // Convert blob to base64 for HTTP upload
      const base64Data = await this.blobToBase64(pdfBlob);
      const base64Content = base64Data.split(',')[1];
      
      // Get the Firebase Storage reference and path
      const fileName = `agreements/${this.clientId}/${Date.now()}_${this.agreementName}.pdf`;
      const storageRef = ref(this.storage, fileName);
      const storagePath = storageRef.fullPath;
      
      // Get the current user's ID token for authentication
      const currentUser = this.auth.currentUser;
      if (!currentUser) {
        throw new Error('User not authenticated. Please log in before uploading files.');
      }
      
      // Get the Firebase ID token
      const idToken = await getIdToken(currentUser);
      console.log('Got ID token for authentication');
      
      // Use Cloud Function with @capacitor-community/http to upload the PDF
      const functionUrl = `${environment.cloudFunctionsBaseUrl}/uploadFile`;
      console.log('Using Cloud Function URL for PDF upload:', functionUrl);
      
      // Create metadata
      const metadata = {
        'original-filename': `${this.agreementName}.pdf`,
        'upload-timestamp': new Date().toISOString(),
        'content-type': 'application/pdf'
      };
      
      // Use @capacitor-community/http to call the Cloud Function
      console.log('Calling Cloud Function with @capacitor-community/http for PDF upload...');
      const response = await Http.request({
        method: 'POST',
        url: functionUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        data: {
          data: {
            base64Data: base64Content,
            path: fileName,
            contentType: 'application/pdf',
            metadata: metadata
          }
        },
        connectTimeout: 30000, // 30 seconds
        readTimeout: 30000, // 30 seconds
        responseType: 'json'
      });
      
      console.log('Cloud Function response status:', response.status);
      
      if (response.status < 200 || response.status >= 300) {
        console.error('Cloud Function response data:', response.data);
        throw new Error(`Cloud Function call failed with status ${response.status}`);
      }

      // Send the agreement to the client using your existing service method
      const agreementId = await this.agreementService.sendAgreementToClient(
        this.clientId,
        this.agreementName,
        this.services,
        this.selectedPolicies,
        trainerName,
        storagePath,
        this.recurring
      );

      // Emit event with agreement ID and storage path
      this.onSend.emit({
        id: agreementId,
        name: this.agreementName,
        storagePath: storagePath
      });
    } catch (error) {
      console.error('Error sending agreement to client:', error);
    } finally {
      await loading.dismiss();
    }
  }
}
