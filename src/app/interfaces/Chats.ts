import { Signal, WritableSignal } from '@angular/core';

export interface Message {
    messageId?: string;
    senderId: string;
    text: string;
    timestamp: string;
    read: boolean;
    type?: 'text' | 'group_invite' | 'join_request';
    groupInvite?: {
        groupId: string;
        groupName: string;
        inviterId: string;
        targetUserId: string;
        status: 'pending' | 'accepted' | 'rejected';
        respondedAt?: string;
        respondedBy?: string;
    };
    joinRequest?: {
        groupId: string;
        groupName: string;
        requesterId: string;
        requesterName: string;
        targetOwnerId: string;
        status: 'pending' | 'accepted' | 'declined';
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
