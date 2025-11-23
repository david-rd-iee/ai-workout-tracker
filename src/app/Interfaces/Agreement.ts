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
    }
    trainer: {
        name: string;
        signedAt: Date;
    }
}

export interface agreementData {
    policies: policy[];
    services: service[];
}

export interface AgreementTemplate {
    id: string;
    name: string;
    agreementData?: agreementData;
    date_created: Date;
    date_updated: Date;
    recurring?: boolean;
}

export interface Agreement {
    id: string;
    name: string;
    trainerId: string;
    clientId: string;
    status: 'pending' | 'completed' | 'partially_signed';
    agreementData?: agreementData;
    agreementStoragePath: string;
    dateCreated: Date;
    dateUpdated: Date;
    signatures?: SignatureData;
    recurring?: boolean;
    chatId?: string;
}

