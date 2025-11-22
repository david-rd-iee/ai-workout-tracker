import { Injectable, signal } from '@angular/core';
import { Firestore, collection, collectionData, addDoc, setDoc, getDoc, doc, getDocs, updateDoc, query, where, deleteDoc, DocumentData } from '@angular/fire/firestore';
import { AccountService } from './account/account.service';
import { policy, service, SignatureData, serviceOption, policyOption, Agreement } from '../Interfaces/Agreement';
import { Observable, map } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class AgreementService {
  // Default service options - these are the standard options available for all services
  private getDefaultServiceOptions(): serviceOption[] {
    return [];
  }
  
  // Default policies - these are the standard policies available for all agreements
  private getDefaultPolicies(): policy[] {
    return [];
  }
  
  // Signals to store the current options loaded from the database
  private defaultServiceOptions = signal<serviceOption[]>([]);
  private defaultPolicies = signal<policy[]>([]);

  constructor(
    private accountService: AccountService,
    private firestore: Firestore
  ) { 
    // Initialize by loading options from database
    this.initializeOptions();
  }
  async saveAgreementTemplate(name: string, services: service[], policies: policy[], recurring: boolean = false, templateId?: string) {
    try {
      const userId = this.accountService.getCredentials()().uid;
      const agreementsCollection = collection(this.firestore, `templates/${userId}/agreements`);
      
      let agreementDocRef;
      let data: any;
      const now = new Date();

      if (templateId) {
        // Update existing template
        agreementDocRef = doc(agreementsCollection, templateId);
        data = {
          name: name,
          agreement_data: {
            services: services,
            policies: policies
          },
          recurring: recurring,
          date_updated: now
        };
      } else {
        // Create new template
        agreementDocRef = doc(agreementsCollection);
        data = {
          name: name,
          agreement_data: {
            services: services,
            policies: policies
          },
          recurring: recurring,
          date_created: now,
          date_updated: now
        };
      }

      await setDoc(agreementDocRef, data, templateId ? { merge: true } : {});
      console.log('Data successfully written to Firestore');
    } catch (error) {
      console.error('Error writing document: ', error);
    }
  }

  async getTemplates() {
    try {
      const userId = this.accountService.getCredentials()().uid;
      const agreementsCollection = collection(this.firestore, `templates/${userId}/agreements`);
      const querySnapshot = await getDocs(agreementsCollection);

      const templates: any[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        templates.push({
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects
          date_created: data['date_created']?.toDate ? data['date_created'].toDate() : data['date_created'],
          date_updated: data['date_updated']?.toDate ? data['date_updated'].toDate() : data['date_updated']
        });
      });
      
      return templates;
    } catch (error) {
      console.error('Error getting agreement templates: ', error);
      return [];
    }
  }
  
  // For backward compatibility
  async getAgreementTemplates() {
    return this.getTemplates();
  }
  
  /**
   * Delete an agreement template
   * @param templateId Template ID to delete
   * @returns Promise that resolves when the delete is complete
   */
  async deleteTemplate(templateId: string) {
    try {
      const userId = this.accountService.getCredentials()().uid;
      const templateDocRef = doc(this.firestore, `templates/${userId}/agreements/${templateId}`);
      
      // First verify the template exists
      const templateDoc = await getDoc(templateDocRef);
      if (!templateDoc.exists()) {
        throw new Error('Template not found');
      }
      
      // Delete the template document
      await deleteDoc(templateDocRef);
      console.log('Template deleted successfully');
      return true;
    } catch (error) {
      console.error('Error deleting template:', error);
      throw error;
    }
  }


  async getTemplateById(templateId: string) {
    try {
      const userId = this.accountService.getCredentials()().uid;
      const templateDocRef = doc(this.firestore, `templates/${userId}/agreements/${templateId}`);
      const templateSnapshot = await getDoc(templateDocRef);

      if (templateSnapshot.exists()) {
        const data = templateSnapshot.data();
        
        // Handle backward compatibility for template data structure
        const rawAgreementData = data['agreement_data'];
        let agreementData = rawAgreementData;
        
        // If we have the old structure, convert it to the new structure
        if (rawAgreementData && rawAgreementData.selected_policies) {
          agreementData = {
            services: rawAgreementData.services || [],
            policies: rawAgreementData.selected_policies || []
          };
        } else if (!rawAgreementData) {
          // Default structure for new templates
          agreementData = {
            services: [],
            policies: []
          };
        }
        
        return {
          id: templateSnapshot.id,
          name: data['name'] || 'Unnamed Template',
          agreement_data: agreementData,
          date_created: data['date_created']?.toDate ? data['date_created'].toDate() : data['date_created'],
          date_updated: data['date_updated']?.toDate ? data['date_updated'].toDate() : data['date_updated']
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting template by ID:', error);
      return null;
    }
  }

  async getAgreementById(agreementId: string): Promise<Agreement | null> {
    try {
      const agreementDocRef = doc(this.firestore, `agreements/${agreementId}`);
      const agreementSnapshot = await getDoc(agreementDocRef);

      if (agreementSnapshot.exists()) {
        const data = agreementSnapshot.data();
        // Ensure we have a valid storage path
        const storagePath = data['agreementStoragePath'];
        if (!storagePath) {
          console.error('No storage path found for agreement:', agreementId);
        }

        // Handle backward compatibility for agreementData structure
        const rawAgreementData = data['agreement_data'] || data['agreementData'];
        let agreementData = rawAgreementData;
        
        // If we have the old structure, convert it to the new structure
        if (rawAgreementData && rawAgreementData.selected_policies) {
          agreementData = {
            services: rawAgreementData.services || [],
            policies: rawAgreementData.selected_policies || []
          };
        }

        return {
          id: agreementSnapshot.id,
          name: data['name'],
          trainerId: data['trainerId'],
          clientId: data['clientId'],
          status: data['status'],
          agreementData: agreementData,
          agreementStoragePath: storagePath || '',
          dateCreated: data['date_created'] || data['dateCreated'],
          dateUpdated: data['date_updated'] || data['dateUpdated'],
          signatures: data['signatures'],
          recurring: data['recurring']
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting agreement by ID:', error);
      return null;
    }
  }

  /**
   * Save pending client signature (before payment)
   * This will be converted to a real signature by the webhook after payment succeeds
   */
  async savePendingClientSignature(agreementId: string, fullName: string) {
    try {
      const agreementDocRef = doc(this.firestore, `agreements/${agreementId}`);
      
      await updateDoc(agreementDocRef, {
        pendingClientSignature: {
          fullName: fullName,
          createdAt: new Date().toISOString(),
          ipAddress: null // Could capture this if needed
        },
        date_updated: new Date()
      });

      console.log('Pending client signature saved - will be finalized after payment');
    } catch (error) {
      console.error('Error saving pending client signature:', error);
      throw error;
    }
  }

  async saveSignature(agreementId: string, signerName: string, signerType: 'trainer' | 'client') {
    try {
      const agreementDocRef = doc(this.firestore, `agreements/${agreementId}`);
      const agreementDoc = await getDoc(agreementDocRef);
      
      if (!agreementDoc.exists()) {
        throw new Error('Agreement not found');
      }

      const data = agreementDoc.data();
      const signatures = data['signatures'] || {};
      const now = new Date();

      // Update signatures object with new signature
      signatures[signerType] = {
        name: signerName,
        signedAt: now.toISOString()
      };

      // Update document
      await updateDoc(agreementDocRef, {
        signatures,
        [`${signerType}Signed`]: true,
        status: signatures['trainer'] && signatures['client'] ? 'completed' : 'partially_signed',
        date_updated: now
      });

      console.log(`${signerType} signature saved successfully`);
      return signatures;
    } catch (error) {
      console.error('Error saving signature:', error);
      throw error;
    }
  }

  async saveSignedPdf(agreementId: string, signedPdfStoragePath: string) {
    try {
      const agreementDocRef = doc(this.firestore, `agreements/${agreementId}`);
      await updateDoc(agreementDocRef, {
        signedPdfStoragePath,
        date_updated: new Date()
      });
      console.log('Signed PDF path saved successfully');
    } catch (error) {
      console.error('Error saving signed PDF path:', error);
      throw error;
    }
  }

  async sendAgreementToClient(
    clientId: string,
    name: string,
    services: service[],
    policies: policy[],
    trainerName: string,
    storagePath: string = '',
    recurring: boolean = false
  ) {
    try {
      const trainerId = this.accountService.getCredentials()().uid;
      const agreementsCollection = collection(this.firestore, 'agreements');
      const agreementDocRef = doc(agreementsCollection);

      const now = new Date();
      const data = {
        trainerId: trainerId,
        clientId: clientId,
        name: name,
        status: 'pending',
        agreement_data: {
          services: services,
          policies: policies
        },
        agreementStoragePath: storagePath,
        signatures: {
          trainer: {
            name: trainerName,
            signedAt: now.toISOString()
          }
        },
        trainerSigned: true,
        clientSigned: false,
        recurring: recurring,
        dateCreated: now,
        dateUpdated: now
      };

      await setDoc(agreementDocRef, data);
      console.log('Agreement sent to client successfully');
      return agreementDocRef.id;
    } catch (error) {
      console.error('Error sending agreement to client:', error);
      throw error;
    }
  }
  
  /**
   * Get agreement by checkout session ID
   * @param checkoutSessionId Stripe checkout session ID
   * @returns Array of agreements matching the checkout session ID
   */
  async getAgreementByCheckoutSessionId(checkoutSessionId: string) {
    try {
      const agreementsCollection = collection(this.firestore, 'agreements');
      const q = query(agreementsCollection, where('checkoutSessionId', '==', checkoutSessionId));
      const querySnapshot = await getDocs(q);
      
      const agreements: any[] = [];
      querySnapshot.forEach((doc) => {
        agreements.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return agreements;
    } catch (error) {
      console.error('Error getting agreement by checkout session ID:', error);
      return [];
    }
  }

  /**
   * Update agreement with payment information
   * @param agreementId Agreement ID to update
   * @param paymentInfo Payment information to update
   * @returns Promise that resolves when the update is complete
   */
  async updateAgreementPaymentInfo(agreementId: string, paymentInfo: any) {
    try {
      const agreementDocRef = doc(this.firestore, `agreements/${agreementId}`);
      const now = new Date();
      
      await updateDoc(agreementDocRef, {
        ...paymentInfo,
        date_updated: now
      });
      
      console.log('Agreement payment info updated successfully');
      return true;
    } catch (error) {
      console.error('Error updating agreement payment info:', error);
      throw error;
    }
  }

  /**
   * Update agreement with new data
   * @param agreementId Agreement ID to update
   * @param updateData Data to update in the agreement
   * @returns Promise that resolves when the update is complete
   */
  async updateAgreement(agreementId: string, updateData: any) {
    try {
      const agreementDocRef = doc(this.firestore, `agreements/${agreementId}`);
      const now = new Date();
      
      await updateDoc(agreementDocRef, {
        ...updateData,
        date_updated: now
      });
      
      console.log('Agreement updated successfully');
      return true;
    } catch (error) {
      console.error('Error updating agreement:', error);
      throw error;
    }
  }

  /**
   * Initialize the service options and policies in the database
   * This will check if options already exist in the database and create them if not
   */
  private async initializeOptions(): Promise<void> {
    try {
      // Check if service options exist in the database
      const serviceOptionsRef = doc(this.firestore, 'agreementOptions/service_options');
      const serviceOptionsDoc = await getDoc(serviceOptionsRef);
      
      if (!serviceOptionsDoc.exists()) {
        this.defaultServiceOptions.set(this.getDefaultServiceOptions());
      } else {
        const data = serviceOptionsDoc.data();
        if (data && data['options']) {
          this.defaultServiceOptions.set(data['options']);
        }
      }
      
      // Check if policy options exist in the database
      const policyOptionsRef = doc(this.firestore, 'agreementOptions/policy_options');
      const policyOptionsDoc = await getDoc(policyOptionsRef);
      
      if (!policyOptionsDoc.exists()) {
        this.defaultPolicies.set(this.getDefaultPolicies());
      } else {
        const data = policyOptionsDoc.data();
        if (data && data['policies']) {
          this.defaultPolicies.set(data['policies']);
        }
      }
    } catch (error) {
      console.error('Error initializing options:', error);
    }
  }

  /**
   * Get service options from database
   * @returns Array of service options
   */
  async getServiceOptions(): Promise<serviceOption[]> {
    try {
      const serviceOptionsRef = doc(this.firestore, 'agreementOptions/service_options');
      const serviceOptionsDoc = await getDoc(serviceOptionsRef);
      
      if (serviceOptionsDoc.exists()) {
        const data = serviceOptionsDoc.data();
        if (data && data['options']) {
          return data['options'];
        }
      }
      
      return this.getDefaultServiceOptions();
    } catch (error) {
      console.error('Error getting service options:', error);
      return this.getDefaultServiceOptions();
    }
  }

  /**
   * Get policy options from database
   * @returns Array of policies
   */
  async getPolicyOptions(): Promise<policy[]> {
    try {
      const policyOptionsRef = doc(this.firestore, 'agreementOptions/policy_options');
      const policyOptionsDoc = await getDoc(policyOptionsRef);
      
      if (policyOptionsDoc.exists()) {
        const data = policyOptionsDoc.data();
        if (data && data['policies']) {
          return data['policies'];
        }
      }
      
      return this.getDefaultPolicies();
    } catch (error) {
      console.error('Error getting policy options:', error);
      return this.getDefaultPolicies();
    }
  }

  /**
   * Update existing templates with the latest options
   */
  async updateExistingTemplates(): Promise<boolean> {
    try {
      const userId = this.accountService.getCredentials()().uid;
      const agreementsCollection = collection(this.firestore, `templates/${userId}/agreements`);
      const querySnapshot = await getDocs(agreementsCollection);
      
      // Get latest options
      const serviceOptions = await this.getServiceOptions();
      const policies = await this.getPolicyOptions();
      
      // Update each template
      const updatePromises = querySnapshot.docs.map(async (docSnapshot) => {
        const templateData = docSnapshot.data();
        const templateRef = doc(this.firestore, `templates/${userId}/agreements/${docSnapshot.id}`);
        
        // Update the policies array in the template
        if (templateData['agreement_data'] && templateData['agreement_data']['policies']) {
          await updateDoc(templateRef, {
            'agreement_data.policies': policies,
            date_updated: new Date()
          });
        }
        
        // Update service options in each service
        if (templateData['agreement_data'] && templateData['agreement_data']['services']) {
          const services = templateData['agreement_data']['services'] as service[];
          
          // For each service, update the unselected service options with the latest options
          services.forEach(service => {
            // Keep track of which options were selected
            const selectedOptionTexts = service.selectedServiceOptions.map((opt: serviceOption) => opt.text);
            
            // Reset unselected options to the latest from the database
            service.unselectedServiceOptions = serviceOptions.filter(
              opt => !selectedOptionTexts.includes(opt.text)
            );
          });
          
          // Update the template with the updated services
          await updateDoc(templateRef, {
            'agreement_data.services': services,
            date_updated: new Date()
          });
        }
      });
      
      await Promise.all(updatePromises);
      console.log('All templates updated with latest options');
      return true;
    } catch (error) {
      console.error('Error updating existing templates:', error);
      return false;
    }
  }
}