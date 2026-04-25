export interface serviceOption {
    text: string;
    placeholder: string;
    value: string;
    numericValue?: number;
    description?: string;
    isNumeric?: boolean;
}

export interface service {
    name: string;
    selectedServiceOptions: serviceOption[];
    unselectedServiceOptions: serviceOption[];
}

export interface policyOption {
    optionDescription: string;
    value: string;
    placeholder: string;
}

export interface policy {
    id: string;
    title: string;
    description: string;
    selectedOptions: policyOption[];
    options: policyOption[];
}

export interface SignatureData {
    client: {
        name: string;
        signedAt: Date;
        signatureStoragePath?: string;
    }
    trainer: {
        name: string;
        signedAt: Date;
        signatureStoragePath?: string;
    }
}

export interface agreementData {
    policies: policy[];
    services: service[];
}

export type AgreementPaymentType = 'one_time' | 'subscription';
export type AgreementPaymentInterval = 'week' | 'month' | 'year';
export type AgreementCurrency = 'usd';
export type AgreementStatus = 'pending' | 'signed' | 'completed' | 'partially_signed';
export type AgreementPaymentStatus =
    'not_required' |
    'not_started' |
    'checkout_started' |
    'paid' |
    'active' |
    'failed' |
    'canceled';

export interface AgreementPaymentTerms {
    required: boolean;
    type: AgreementPaymentType;
    amountCents: number;
    currency: AgreementCurrency;
    interval?: AgreementPaymentInterval;
    description: string;
}

export interface AgreementTemplate {
    id: string;
    name: string;
    agreementData?: agreementData;
    date_created: Date;
    date_updated: Date;
    recurring?: boolean;
    paymentTerms?: AgreementPaymentTerms;
}

export interface Agreement {
    id: string;
    name: string;
    trainerId: string;
    clientId: string;
    status: AgreementStatus;
    agreementStatus: AgreementStatus;
    agreementData?: agreementData;
    agreementStoragePath: string;
    trainerName?: string;
    clientName?: string;
    dateCreated: Date;
    dateUpdated: Date;
    signedAt?: Date;
    effectiveAt?: Date;
    sourceAgreementId?: string;
    signatures?: SignatureData;
    recurring?: boolean;
    chatId?: string;
    signedAgreementStoragePath?: string;
    activePaymentTerms?: AgreementPaymentTerms;
    pendingPaymentTerms?: AgreementPaymentTerms;
    // Legacy mirror for older reads. Prefer activePaymentTerms for billing decisions.
    paymentTerms?: AgreementPaymentTerms;
    paymentStatus?: AgreementPaymentStatus;
    stripeCheckoutSessionId?: string;
    stripePaymentIntentId?: string;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
}
