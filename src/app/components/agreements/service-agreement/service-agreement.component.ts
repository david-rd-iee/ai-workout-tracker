import { ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonCheckbox, IonIcon, IonInput, IonLabel, LoadingController, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { add, chevronDownOutline, chevronUpOutline, informationCircleOutline, remove } from 'ionicons/icons';
import { TruncatePipe } from 'src/app/pipes/truncate.pipe';
import { AgreementService } from 'src/app/services/agreement.service';
import { policy, service } from 'src/app/Interfaces/Agreement';
import { UserService } from 'src/app/services/account/user.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { FileUploadService } from 'src/app/services/file-upload.service';

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
    TruncatePipe
  ]
})
export class ServiceAgreementComponent implements OnInit {
  @Input() templateId: string | null = null;
  @Input() agreementName: string = '';
  
  @Output() onSave = new EventEmitter<any>();
  @Output() onSend = new EventEmitter<{ id: string; name: string; storagePath: string }>();
  @Input() mode: 'template' | 'client' = 'template'; // Default to template mode
  @Input() clientId: string | null = null; // Add clientId for client mode
  @Input() clientName: string = '';

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
    private fileUploadService: FileUploadService,
    private loadingController: LoadingController,
    private userService: UserService,
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
        this.agreementName = String(template['name'] || 'New Agreement');

        // Map the agreement data to your component
        const agreementData = template['agreement_data'] as { services?: service[]; policies?: policy[] } | undefined;
        if (agreementData) {
          if (agreementData.services) {
            this.services = agreementData.services;
          }

          if (agreementData.policies) {
            this.selectedPolicies = agreementData.policies;
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
    void name;
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
    const htmlDocument = this.buildAgreementSnapshotHtml();

    return new Blob([htmlDocument], { type: 'text/html;charset=utf-8' });
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
      const fileName = `${this.agreementName.replace(/\s+/g, '_')}.html`;
      
      // Convert blob to base64
      const base64Data = await this.blobToBase64(pdfBlob);
      const base64Content = base64Data.split(',')[1];
      
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
          message: `Agreement saved to Documents/${fileName}`,
          duration: 3000,
          position: 'bottom'
        });
        await toast.present();
        
        void result;
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
      console.error('Error generating or saving agreement document:', error);
      const toast = await this.toastController.create({
        message: 'Failed to save agreement document. Please try again.',
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
      if (!this.agreementName.trim()) {
        const toast = await this.toastController.create({
          message: 'Give this agreement a name before saving it.',
          duration: 2500,
          position: 'bottom',
          color: 'warning'
        });
        await toast.present();
        return;
      }

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
      if (!this.agreementName.trim()) {
        const toast = await this.toastController.create({
          message: 'Give this agreement a clear name before sending it.',
          duration: 2500,
          position: 'bottom',
          color: 'warning'
        });
        await toast.present();
        return;
      }

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
      
      const safeAgreementName = this.agreementName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
      const fileName = `agreements/${this.clientId}/${Date.now()}_${safeAgreementName}.html`;
      const htmlFile = this.base64ToFile(
        base64Data,
        `${safeAgreementName}.html`,
        'text/html'
      );

      await this.fileUploadService.uploadFile(fileName, htmlFile);

      // Send the agreement to the client using your existing service method
      const agreementId = await this.agreementService.sendAgreementToClient(
        this.clientId,
        this.agreementName,
        this.services,
        this.selectedPolicies,
        trainerName,
        fileName,
        this.recurring
      );

      // Emit event with agreement ID and storage path
      this.onSend.emit({
        id: agreementId,
        name: this.agreementName,
        storagePath: fileName
      });
    } catch (error) {
      console.error('Error sending agreement to client:', error);
    } finally {
      await loading.dismiss();
    }
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private buildAgreementSnapshotHtml(): string {
    const title = this.escapeHtml(this.agreementName || 'Training Agreement');
    const serviceSections = this.services
      .map((serviceEntry, index) => this.renderServiceSection(serviceEntry, index))
      .join('');
    const policySections = this.selectedPolicies
      .map((policyEntry) => this.renderPolicySection(policyEntry))
      .join('');
    const recurringSection = this.recurring
      ? '<p class="recurring-charge-text">This agreement includes a monthly recurring charge.</p>'
      : '<p class="recurring-charge-text">This agreement does not include a monthly recurring charge.</p>';

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 32px 20px;
              font-family: Inter, "Segoe UI", Arial, sans-serif;
              color: #1f2a3d;
              background: #f4f7fb;
              line-height: 1.6;
            }
            .document {
              max-width: 860px;
              margin: 0 auto;
              background: #ffffff;
              border-radius: 24px;
              padding: 32px;
              box-shadow: 0 18px 48px rgba(31, 42, 61, 0.08);
            }
            h1, h2, h3, h4, p { margin-top: 0; }
            h1 {
              font-size: 30px;
              margin-bottom: 10px;
              color: #1b3158;
            }
            h2 {
              margin: 28px 0 12px;
              font-size: 22px;
              color: #214fbd;
            }
            h3 {
              margin: 18px 0 10px;
              font-size: 18px;
              color: #314766;
            }
            .lead {
              color: #5f6f87;
              margin-bottom: 24px;
            }
            .card {
              background: #f6f8fc;
              border: 1px solid #dde6f3;
              border-radius: 18px;
              padding: 18px 20px;
              margin-bottom: 16px;
            }
            .label {
              font-size: 12px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: #7a8da9;
              font-weight: 700;
              margin-bottom: 4px;
            }
            .value {
              color: #24354f;
              font-weight: 600;
            }
            ul {
              margin: 10px 0 0 18px;
              padding: 0;
            }
            li + li {
              margin-top: 10px;
            }
            .muted {
              color: #6f7f97;
            }
            .footnote {
              margin-top: 28px;
              padding-top: 20px;
              border-top: 1px solid #dde6f3;
              color: #566781;
            }
            .signature-note {
              margin-top: 18px;
              padding: 14px 16px;
              border-radius: 14px;
              background: #edf3ff;
              border: 1px solid #d7e3fb;
              color: #2d4675;
            }
          </style>
        </head>
        <body>
          <div class="document">
            <h1>${title}</h1>
            <p class="lead">Trainer service agreement prepared through Atlas.</p>

            <section>
              <h2>Term Overview</h2>
              <div class="card">
                <p>${this.escapeHtml(this.dsiclamermsg)}</p>
              </div>
            </section>

            <section>
              <h2>Services</h2>
              ${serviceSections || '<div class="card"><p class="muted">No services were added to this agreement.</p></div>'}
            </section>

            <section>
              <h2>Policies</h2>
              <div class="card">
                <h3>Trainer cancellation policy</h3>
                <p>If the Trainer is unable to perform the session, the client can request to have the full session refunded or have the session made up at the earliest convenience of both parties within two weeks of the scheduled session date. If the make-up session does not occur within this timeframe, a full refund will be issued.</p>
                <h3>Trainer late policy</h3>
                <p>If the Trainer is more than 15 minutes late to the training session, the client can request that the session be made up at the earliest convenience of both parties within two weeks of the scheduled session date. If the make-up session does not occur within this timeframe, a full refund will be issued.</p>
              </div>
              ${policySections || '<div class="card"><p class="muted">No additional optional policies were selected for this agreement.</p></div>'}
            </section>

            <section>
              <h2>Payment Terms</h2>
              <div class="card">
                ${recurringSection}
              </div>
            </section>

            <div class="footnote">
              <p>By signing this agreement, the client acknowledges that they have read, understood, and agreed to the terms and conditions outlined above.</p>
              <div class="signature-note">
                Electronic signature is completed in Atlas and stored with this agreement record.
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private renderServiceSection(serviceEntry: service, index: number): string {
    const serviceName = this.escapeHtml(serviceEntry?.name || `Service ${index + 1}`);
    const selectedOptions = (serviceEntry?.selectedServiceOptions || [])
      .map((option) => {
        const rawValue = String(option?.value || '').trim();
        const displayValue = rawValue
          ? this.escapeHtml(this.formatServiceOptionValue(option, rawValue))
          : 'Not specified';
        return `
          <li>
            <div class="label">${this.escapeHtml(option?.text || 'Detail')}</div>
            <div class="value">${displayValue}</div>
          </li>
        `;
      })
      .join('');

    return `
      <div class="card">
        <h3>${serviceName}</h3>
        ${selectedOptions ? `<ul>${selectedOptions}</ul>` : '<p class="muted">No service details were selected.</p>'}
      </div>
    `;
  }

  private renderPolicySection(policyEntry: policy): string {
    const title = this.escapeHtml(policyEntry?.title || 'Policy');
    const description = this.escapeHtml(policyEntry?.description || '');
    const selectedOptions = (policyEntry?.selectedOptions || [])
      .map((option) => {
        const rawValue = String(option?.value || '').trim();
        const hasValue = rawValue && rawValue.toLowerCase() !== 'none';
        return `
          <li>
            <div class="label">${this.escapeHtml(option?.optionDescription || 'Policy detail')}</div>
            <div class="value">${hasValue ? this.escapeHtml(rawValue) : 'Included'}</div>
          </li>
        `;
      })
      .join('');

    return `
      <div class="card">
        <h3>${title}</h3>
        ${description ? `<p>${description}</p>` : ''}
        ${selectedOptions ? `<ul>${selectedOptions}</ul>` : '<p class="muted">No additional policy details were selected.</p>'}
      </div>
    `;
  }

  private formatServiceOptionValue(option: any, rawValue: string): string {
    const normalizedLabel = String(option?.text || '').trim().toLowerCase();
    const normalizedPlaceholder = String(option?.placeholder || '').trim().toLowerCase();
    const normalizedDescription = String(option?.description || '').trim().toLowerCase();
    const value = String(rawValue || '').trim();
    const numericValue = Number(value);
    const isNumericValue = Number.isFinite(numericValue);
    const pluralize = (base: string) => {
      if (!isNumericValue) {
        return base;
      }
      return numericValue === 1 ? base : `${base}s`;
    };

    if (normalizedLabel === 'price per session') {
      return value.startsWith('$') ? value : `$${value}`;
    }

    if (
      (normalizedLabel === 'program length' ||
        /\bweek\b/.test(normalizedPlaceholder) ||
        /\bweek\b/.test(normalizedDescription)) &&
      !/\bweek/i.test(value)
    ) {
      return `${value} ${pluralize('week')}`;
    }

    if (
      (normalizedLabel === 'session duration' ||
        /\b(min|minute)\b/.test(normalizedPlaceholder) ||
        /\b(min|minute)\b/.test(normalizedDescription)) &&
      !/\b(min|minute)\b/i.test(value)
    ) {
      return `${value} ${pluralize('minute')}`;
    }

    if (
      normalizedLabel === 'sessions per week' ||
      (/\bsession/.test(normalizedLabel) && /\bweek\b/.test(normalizedPlaceholder))
    ) {
      if (/\bweek\b/i.test(value)) {
        return value;
      }
      return `${value} ${pluralize('session')} per week`;
    }

    if (/\b(hour|hours)\b/.test(normalizedPlaceholder) && !/\b(hour|hours|hr|hrs)\b/i.test(value)) {
      return `${value} ${pluralize('hour')}`;
    }

    if (/\b(day|days)\b/.test(normalizedPlaceholder) && !/\bday/i.test(value)) {
      return `${value} ${pluralize('day')}`;
    }

    if (/\b(month|months)\b/.test(normalizedPlaceholder) && !/\bmonth/i.test(value)) {
      return `${value} ${pluralize('month')}`;
    }

    if (/\b(session|sessions)\b/.test(normalizedPlaceholder) && !/\bsession/i.test(value)) {
      return `${value} ${pluralize('session')}`;
    }

    if (/\b(amount|price|cost|rate)\b/.test(normalizedPlaceholder) && isNumericValue && !value.startsWith('$')) {
      return `$${value}`;
    }

    return value;
  }

  private base64ToFile(dataUrl: string, fileName: string, contentType: string): File {
    const base64Content = dataUrl.split(',')[1] || '';
    const byteCharacters = atob(base64Content);
    const byteNumbers = new Array(byteCharacters.length);

    for (let index = 0; index < byteCharacters.length; index += 1) {
      byteNumbers[index] = byteCharacters.charCodeAt(index);
    }

    const byteArray = new Uint8Array(byteNumbers);
    return new File([byteArray], fileName, { type: contentType });
  }
}
