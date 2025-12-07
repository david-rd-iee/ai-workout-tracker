import { Signal } from '@angular/core';
//import { trainerProfile } from '../Interfaces/Profiles/Trainer';
//import { clientProfile } from './Profiles/Client';

export interface Message {
    messageId?: string;
    senderId: string;
    text: string;
    timestamp: string;
    read: boolean;
}

export interface Chat {
    chatId: string;
    participants: string[];
    lastMessage: string;
    lastMessageTime: string;
    messages: { [key: string]: Message };
   // userProfile?: Signal<trainerProfile | clientProfile | null>;
    hasUnreadMessages?: boolean;
    twilioChatId?: string;
}

export interface ChatRequest {
    userId: string;
    timestamp: string;
    status: 'pending' | 'accepted' | 'rejected';
}