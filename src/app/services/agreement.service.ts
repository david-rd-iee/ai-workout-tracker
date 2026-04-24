import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Storage, getDownloadURL, ref, uploadString } from '@angular/fire/storage';
import {
  Agreement,
  AgreementTemplate,
  agreementData,
  policy,
  policyOption,
  service,
  serviceOption,
} from '../Interfaces/Agreement';
import { ChatsService } from './chats.service';

type AgreementRole = 'trainer' | 'client';

@Injectable({
  providedIn: 'root',
})
export class AgreementService {
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);
  private readonly chatsService = inject(ChatsService);

  private readonly defaultServiceOptions: serviceOption[] = [
    { text: 'Session Duration', placeholder: 'Enter minutes', value: '', isNumeric: true },
    { text: 'Price Per Session', placeholder: 'Enter amount', value: '', isNumeric: true },
    { text: 'Sessions Per Week', placeholder: 'Enter sessions', value: '', isNumeric: true },
    { text: 'Program Length', placeholder: 'Enter weeks', value: '', isNumeric: true },
    { text: 'Support Channel', placeholder: 'Example: Atlas chat', value: '' },
    { text: 'Nutrition Guidance', placeholder: 'Describe support included', value: '' },
  ];

  private readonly defaultPolicies: policy[] = [
    {
      id: 'rescheduling',
      title: 'Rescheduling Policy',
      description: 'Define how much notice is required before moving a session.',
      selectedOptions: [],
      options: [
        { optionDescription: 'Minimum notice required', value: '', placeholder: 'Example: 24 hours' },
        { optionDescription: 'Reschedule limit per month', value: '', placeholder: 'Example: 2' },
      ],
    },
    {
      id: 'late-arrivals',
      title: 'Late Arrival Policy',
      description: 'Set expectations if the client arrives late to a booked session.',
      selectedOptions: [],
      options: [
        { optionDescription: 'Grace period', value: '', placeholder: 'Example: 10 minutes' },
        { optionDescription: 'Session shortened after grace period', value: 'none', placeholder: '' },
      ],
    },
    {
      id: 'refunds',
      title: 'Refund Policy',
      description: 'Clarify how refunds or credits are handled for unused sessions.',
      selectedOptions: [],
      options: [
        { optionDescription: 'Refund window', value: '', placeholder: 'Example: 7 days' },
        { optionDescription: 'Credit offered instead of refund', value: 'none', placeholder: '' },
      ],
    },
  ];

  async getAgreementTemplates(): Promise<AgreementTemplate[]> {
    const trainerId = this.getRequiredCurrentUserId();
    const templatesRef = collection(this.firestore, 'agreementTemplates');
    const templatesQuery = query(
      templatesRef,
      where('trainerId', '==', trainerId),
      orderBy('date_updated', 'desc')
    );
    const snapshot = await getDocs(templatesQuery);

    return snapshot.docs.map((templateDoc) => {
      const data = templateDoc.data() as Record<string, any>;
      return {
        id: templateDoc.id,
        name: String(data['name'] || 'Untitled Agreement'),
        agreementData: data['agreement_data'],
        date_created: this.toDate(data['date_created']),
        date_updated: this.toDate(data['date_updated']),
        recurring: Boolean(data['recurring']),
      };
    });
  }

  async getTemplateById(templateId: string): Promise<Record<string, any> | null> {
    const templateSnap = await getDoc(doc(this.firestore, 'agreementTemplates', templateId));
    if (!templateSnap.exists()) {
      return null;
    }
    return {
      id: templateSnap.id,
      ...templateSnap.data(),
    };
  }

  async deleteAgreementTemplate(templateId: string): Promise<void> {
    const trainerId = this.getRequiredCurrentUserId();
    const templateRef = doc(this.firestore, 'agreementTemplates', templateId);
    const templateSnap = await getDoc(templateRef);
    if (!templateSnap.exists()) {
      return;
    }

    const data = templateSnap.data() as Record<string, any>;
    if (String(data['trainerId'] || '').trim() !== trainerId) {
      throw new Error('You can only delete your own agreement templates.');
    }

    await deleteDoc(templateRef);
  }

  async saveAgreementTemplate(
    name: string,
    services: service[],
    policies: policy[],
    recurring: boolean,
    templateId?: string
  ): Promise<string> {
    const trainerId = this.getRequiredCurrentUserId();
    const templateRef = templateId && templateId !== 'new'
      ? doc(this.firestore, 'agreementTemplates', templateId)
      : doc(collection(this.firestore, 'agreementTemplates'));

    const existingTemplate = await getDoc(templateRef);
    const now = new Date();

    await setDoc(
      templateRef,
      {
        trainerId,
        name: name.trim() || 'Untitled Agreement',
        agreement_data: {
          services: this.cloneServices(services),
          policies: this.clonePolicies(policies),
        },
        recurring: Boolean(recurring),
        date_created: existingTemplate.exists() ? existingTemplate.data()?.['date_created'] ?? now : now,
        date_updated: now,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return templateRef.id;
  }

  async getServiceOptions(): Promise<serviceOption[]> {
    return this.cloneServiceOptions(this.defaultServiceOptions);
  }

  async getPolicyOptions(): Promise<policy[]> {
    return this.clonePolicies(this.defaultPolicies);
  }

  async sendAgreementToClient(
    clientId: string,
    agreementName: string,
    services: service[],
    policies: policy[],
    trainerName: string,
    storagePath: string,
    recurring = false
  ): Promise<string> {
    const trainerId = this.getRequiredCurrentUserId();
    const clientProfile = await this.getClientProfileName(clientId);
    const agreementRef = doc(collection(this.firestore, 'agreements'));
    const now = new Date();

    await setDoc(doc(this.firestore, 'agreements', agreementRef.id), {
      id: agreementRef.id,
      name: agreementName.trim() || 'Training Agreement',
      trainerId,
      clientId,
      trainerName: trainerName.trim(),
      clientName: clientProfile,
      status: 'pending',
      agreement_data: {
        services: this.cloneServices(services),
        policies: this.clonePolicies(policies),
      },
      agreementStoragePath: storagePath,
      recurring: Boolean(recurring),
      dateCreated: now,
      dateUpdated: now,
      signatures: {
        trainer: {
          name: trainerName.trim(),
          signedAt: now,
        },
      },
      updatedAt: serverTimestamp(),
    });

    await this.postAgreementChatEvent(
      trainerId,
      clientId,
      `${agreementName.trim() || 'A new agreement'} has been sent to you for review and signature.`
    );

    return agreementRef.id;
  }

  async getAgreementsForRole(role: AgreementRole, userId?: string): Promise<Agreement[]> {
    const resolvedUserId = String(userId || this.auth.currentUser?.uid || '').trim();
    if (!resolvedUserId) {
      return [];
    }

    const field = role === 'trainer' ? 'trainerId' : 'clientId';
    const agreementsQuery = query(
      collection(this.firestore, 'agreements'),
      where(field, '==', resolvedUserId),
      orderBy('dateUpdated', 'desc')
    );
    const snapshot = await getDocs(agreementsQuery);

    return snapshot.docs.map((agreementDoc) => this.mapAgreementDoc(agreementDoc.id, agreementDoc.data()));
  }

  async getAgreementById(agreementId: string): Promise<Agreement | null> {
    const agreementSnap = await getDoc(doc(this.firestore, 'agreements', agreementId));
    if (!agreementSnap.exists()) {
      return null;
    }

    return this.mapAgreementDoc(agreementSnap.id, agreementSnap.data());
  }

  async resolveAgreementDownloadUrl(storagePath: string): Promise<string> {
    const path = String(storagePath || '').trim();
    if (!path) {
      return '';
    }
    return getDownloadURL(ref(this.storage, path));
  }

  getAgreementDocumentPath(agreement: Agreement): string {
    return String(agreement.signedAgreementStoragePath || agreement.agreementStoragePath || '').trim();
  }

  async signAgreement(agreementId: string, signerName: string, signatureDataUrl: string): Promise<void> {
    const agreement = await this.getAgreementById(agreementId);
    if (!agreement) {
      throw new Error('Agreement not found.');
    }

    const clientId = String(this.auth.currentUser?.uid || '').trim();
    if (!clientId || agreement.clientId !== clientId) {
      throw new Error('Only the assigned client can sign this agreement.');
    }

    if (agreement.status === 'signed') {
      throw new Error('This agreement has already been signed.');
    }

    const signaturePath = `agreements/${clientId}/signatures/${agreementId}.png`;
    await uploadString(ref(this.storage, signaturePath), signatureDataUrl, 'data_url');

    const signedAt = new Date();
    const signedDocumentPath = `agreements/${clientId}/signed/${agreementId}.html`;
    const signedAgreementHtml = this.buildAgreementSnapshotHtml(agreement, signerName.trim(), signedAt, signatureDataUrl);
    await uploadString(
      ref(this.storage, signedDocumentPath),
      signedAgreementHtml,
      'raw',
      { contentType: 'text/html;charset=utf-8' }
    );

    await updateDoc(doc(this.firestore, 'agreements', agreementId), {
      status: 'signed',
      dateUpdated: signedAt,
      signedAgreementStoragePath: signedDocumentPath,
      signatures: {
        trainer: agreement.signatures?.trainer ?? null,
        client: {
          name: signerName.trim(),
          signedAt,
          signatureStoragePath: signaturePath,
        },
      },
      updatedAt: serverTimestamp(),
    });

    await this.postAgreementChatEvent(
      clientId,
      agreement.trainerId,
      `${agreement.name || 'Your agreement'} has been signed by ${signerName.trim() || agreement.clientName || 'the client'}.`
    );
  }

  private async postAgreementChatEvent(senderId: string, recipientId: string, message: string): Promise<void> {
    try {
      const chatId = await this.chatsService.findOrCreateDirectChat(senderId, recipientId);
      await this.chatsService.sendMessage(chatId, senderId, message);
    } catch (error) {
      console.error('Error posting agreement chat event:', error);
    }
  }

  private getRequiredCurrentUserId(): string {
    const userId = String(this.auth.currentUser?.uid || '').trim();
    if (!userId) {
      throw new Error('You must be logged in to manage agreements.');
    }
    return userId;
  }

  private async getClientProfileName(clientId: string): Promise<string> {
    const [userSnap, clientSnap] = await Promise.all([
      getDoc(doc(this.firestore, 'users', clientId)),
      getDoc(doc(this.firestore, 'clients', clientId)),
    ]);

    const userData = userSnap.exists() ? (userSnap.data() as Record<string, any>) : {};
    const clientData = clientSnap.exists() ? (clientSnap.data() as Record<string, any>) : {};
    const firstName = String(userData['firstName'] || clientData['firstName'] || '').trim();
    const lastName = String(userData['lastName'] || clientData['lastName'] || '').trim();
    return `${firstName} ${lastName}`.trim();
  }

  private mapAgreementDoc(agreementId: string, data: Record<string, any>): Agreement {
    return {
      id: agreementId,
      name: String(data['name'] || 'Agreement'),
      trainerId: String(data['trainerId'] || ''),
      clientId: String(data['clientId'] || ''),
      trainerName: String(data['trainerName'] || ''),
      clientName: String(data['clientName'] || ''),
      status: this.normalizeStatus(data['status']),
      agreementData: data['agreement_data'],
      agreementStoragePath: String(data['agreementStoragePath'] || ''),
      dateCreated: this.toDate(data['dateCreated']),
      dateUpdated: this.toDate(data['dateUpdated']),
      signatures: data['signatures'],
      recurring: Boolean(data['recurring']),
      chatId: String(data['chatId'] || ''),
      signedAgreementStoragePath: String(data['signedAgreementStoragePath'] || ''),
    };
  }

  private normalizeStatus(status: unknown): Agreement['status'] {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'signed' || normalized === 'completed' || normalized === 'partially_signed') {
      return normalized as Agreement['status'];
    }
    return 'pending';
  }

  private toDate(value: any): Date {
    if (value instanceof Date) {
      return value;
    }
    if (value?.toDate instanceof Function) {
      return value.toDate();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private cloneServices(services: service[]): service[] {
    return (services || []).map((entry) => ({
      name: String(entry?.name || ''),
      selectedServiceOptions: this.cloneServiceOptions(entry?.selectedServiceOptions || []),
      unselectedServiceOptions: this.cloneServiceOptions(entry?.unselectedServiceOptions || []),
    }));
  }

  private cloneServiceOptions(options: serviceOption[]): serviceOption[] {
    return (options || []).map((option) => {
      const clonedOption: serviceOption = {
        text: String(option?.text || ''),
        placeholder: String(option?.placeholder || ''),
        value: String(option?.value || ''),
        isNumeric: Boolean(option?.isNumeric),
      };

      if (typeof option?.numericValue === 'number' && Number.isFinite(option.numericValue)) {
        clonedOption.numericValue = option.numericValue;
      }

      if (typeof option?.description === 'string' && option.description.trim()) {
        clonedOption.description = option.description;
      }

      return clonedOption;
    });
  }

  private clonePolicies(policies: policy[]): policy[] {
    return (policies || []).map((entry) => ({
      id: String(entry?.id || ''),
      title: String(entry?.title || ''),
      description: String(entry?.description || ''),
      selectedOptions: this.clonePolicyOptions(entry?.selectedOptions || []),
      options: this.clonePolicyOptions(entry?.options || []),
    }));
  }

  private clonePolicyOptions(options: policyOption[]): policyOption[] {
    return (options || []).map((option) => {
      const clonedOption: policyOption = {
        optionDescription: String(option?.optionDescription || ''),
        value: String(option?.value || ''),
        placeholder: String(option?.placeholder || ''),
      };

      return clonedOption;
    });
  }

  private buildAgreementSnapshotHtml(
    agreement: Agreement,
    clientSignerName?: string,
    clientSignedAt?: Date,
    signatureDataUrl?: string
  ): string {
    const title = this.escapeHtml(agreement.name || 'Training Agreement');
    const serviceSections = (agreement.agreementData?.services || [])
      .map((serviceEntry, index) => this.renderServiceSection(serviceEntry, index))
      .join('');
    const policySections = (agreement.agreementData?.policies || [])
      .map((policyEntry) => this.renderPolicySection(policyEntry))
      .join('');
    const recurringSection = agreement.recurring
      ? '<p class="recurring-charge-text">This agreement includes a monthly recurring charge.</p>'
      : '<p class="recurring-charge-text">This agreement does not include a monthly recurring charge.</p>';
    const trainerSignedAt = agreement.signatures?.trainer?.signedAt
      ? this.formatSignedDate(agreement.signatures.trainer.signedAt)
      : this.formatSignedDate(agreement.dateCreated);
    const clientSignedMarkup = clientSignerName && clientSignedAt
      ? `
        <div class="signature-card">
          <div class="signature-meta">
            <div>
              <div class="label">Client signed by</div>
              <div class="value">${this.escapeHtml(clientSignerName)}</div>
            </div>
            <div>
              <div class="label">Signed at</div>
              <div class="value">${this.escapeHtml(this.formatSignedDate(clientSignedAt))}</div>
            </div>
          </div>
          ${signatureDataUrl ? `<img class="signature-image" src="${signatureDataUrl}" alt="Client signature" />` : ''}
        </div>
      `
      : '<p class="muted">Awaiting client signature.</p>';

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
            h1 { font-size: 30px; margin-bottom: 10px; color: #1b3158; }
            h2 { margin: 28px 0 12px; font-size: 22px; color: #214fbd; }
            h3 { margin: 18px 0 10px; font-size: 18px; color: #314766; }
            .lead { color: #5f6f87; margin-bottom: 24px; }
            .card, .signature-card {
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
            .value { color: #24354f; font-weight: 600; }
            ul { margin: 10px 0 0 18px; padding: 0; }
            li + li { margin-top: 10px; }
            .muted { color: #6f7f97; }
            .footnote {
              margin-top: 28px;
              padding-top: 20px;
              border-top: 1px solid #dde6f3;
              color: #566781;
            }
            .signature-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
            }
            .signature-meta {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
              margin-bottom: 14px;
            }
            .signature-image {
              max-width: 100%;
              max-height: 140px;
              display: block;
              padding: 12px;
              border-radius: 14px;
              background: #fff;
              border: 1px solid #d7e3fb;
            }
            @media (max-width: 700px) {
              .signature-grid, .signature-meta { grid-template-columns: 1fr; }
            }
          </style>
        </head>
        <body>
          <div class="document">
            <h1>${title}</h1>
            <p class="lead">Trainer service agreement prepared through Atlas.</p>

            <section class="signature-grid">
              <div class="signature-card">
                <div class="label">Trainer</div>
                <div class="value">${this.escapeHtml(agreement.trainerName || 'Trainer')}</div>
                <div class="label" style="margin-top: 14px;">Trainer signed at</div>
                <div class="value">${this.escapeHtml(trainerSignedAt)}</div>
              </div>
              ${clientSignedMarkup}
            </section>

            <section>
              <h2>Term Overview</h2>
              <div class="card">
                <p>By agreeing to these terms, the Client acknowledges the inherent risks of physical activity and confirms that they have disclosed any medical conditions that may impact their ability to exercise safely. The Client also agrees to inform the Trainer of any health changes and understands that all personal health information will remain confidential. Additionally, the Client agrees not to share or distribute the Trainer's intellectual property, including training materials or resources, without prior written consent. The Trainer will ensure a safe training environment, provide evidence-based guidance tailored to the Client's goals, and maintain professional standards. Any changes to this agreement must be made through the Atlas App's messaging portal, with all communication, payments, and bookings handled through the App for security and transparency.</p>
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
              <div class="card">${recurringSection}</div>
            </section>

            <div class="footnote">
              <p>By signing this agreement, the client acknowledges that they have read, understood, and agreed to the terms and conditions outlined above.</p>
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

  private formatServiceOptionValue(option: serviceOption, rawValue: string): string {
    const normalizedLabel = String(option?.text || '').trim().toLowerCase();
    const normalizedPlaceholder = String(option?.placeholder || '').trim().toLowerCase();
    const normalizedDescription = String(option?.description || '').trim().toLowerCase();
    const value = String(rawValue || '').trim();
    const numericValue = Number(value);
    const isWholeNumericValue = Number.isFinite(numericValue);
    const pluralize = (base: string) => {
      if (!isWholeNumericValue) {
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

    if (
      /\b(hour|hours)\b/.test(normalizedPlaceholder) &&
      !/\b(hour|hours|hr|hrs)\b/i.test(value)
    ) {
      return `${value} ${pluralize('hour')}`;
    }

    if (
      /\b(day|days)\b/.test(normalizedPlaceholder) &&
      !/\bday/i.test(value)
    ) {
      return `${value} ${pluralize('day')}`;
    }

    if (
      /\b(month|months)\b/.test(normalizedPlaceholder) &&
      !/\bmonth/i.test(value)
    ) {
      return `${value} ${pluralize('month')}`;
    }

    if (
      /\b(session|sessions)\b/.test(normalizedPlaceholder) &&
      !/\bsession/i.test(value)
    ) {
      return `${value} ${pluralize('session')}`;
    }

    if (
      /\b(amount|price|cost|rate)\b/.test(normalizedPlaceholder) &&
      isWholeNumericValue &&
      !value.startsWith('$')
    ) {
      return `$${value}`;
    }

    return value;
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

  private formatSignedDate(value: unknown): string {
    const date = this.toDate(value);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
