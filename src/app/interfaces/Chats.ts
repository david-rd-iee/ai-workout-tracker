import { Signal, WritableSignal } from '@angular/core';

export interface Message {
    messageId?: string;
    senderId: string;
    text: string;
    timestamp: string;
    read: boolean;
    type?: 'text' | 'group_invite';
    groupInvite?: {
        groupId: string;
        groupName: string;
        inviterId: string;
        targetUserId: string;
        status: 'pending' | 'accepted' | 'rejected';
        respondedAt?: string;
        respondedBy?: string;
    };
}

export interface Chat {
    chatId: string;
    participants: string[];
    lastMessage: string;
    lastMessageTime: string;
    messages: { [key: string]: Message };
    userProfile?: Signal<any>;
    hasUnreadMessages?: boolean;
    twilioChatId?: string;
}

export interface ChatRequest {
    userId: string;
    timestamp: string;
    status: 'pending' | 'accepted' | 'rejected';
}
