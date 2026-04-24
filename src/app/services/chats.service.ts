import { Injectable } from '@angular/core';
import { Database, ref, push, set, onValue, get, update } from '@angular/fire/database';
import { Observable, BehaviorSubject } from 'rxjs';
import { Chat, Message } from '../Interfaces/Chats';
import { UserService } from './account/user.service';
import { NotificationService } from './notification.service';
import { getFunctions, httpsCallable } from 'firebase/functions';

type EnsureGroupChatForGroupRequest = {
  groupId: string;
};

type EnsureGroupChatForGroupResponse = {
  chatId: string;
  created: boolean;
};

type ChatSummaryRecord = {
  chatId: string;
  participants: string[];
  lastMessage: string;
  lastMessageTime: string;
  type?: 'direct' | 'group';
  groupId?: string;
  displayName?: string;
  groupImage?: string;
  isGroupChat?: boolean;
  unreadByUser?: Record<string, boolean>;
  unreadCountByUser?: Record<string, number>;
  lastReadAtByUser?: Record<string, string>;
};

@Injectable({
  providedIn: 'root'
})
export class ChatsService {
  private readonly chatsRoot = 'chats';
  private readonly chatSummariesRoot = 'chatSummaries';
  private readonly userChatsRoot = 'userChats';
  private chatsSubject = new BehaviorSubject<Chat[]>([]);
  public chats$ = this.chatsSubject.asObservable();
  private initialized = false;
  private initializedUserKey: string | null = null;
  private userChatsUnsubscribe: (() => void) | null = null;
  private chatUnsubscribes = new Map<string, () => void>();
  private chatSummaryBootstrapInFlight = new Set<string>();
  private chatCache = new Map<string, Chat>();
  private profileSignalCache = new Map<string, ReturnType<UserService['getUserById']>>();
  
  constructor(
    private db: Database, 
    private userService: UserService, 
    private notificationService: NotificationService
  ) { }

  // Create a new chat between two users
  async createChat(userId1: string, userId2: string): Promise<string> {
    const chatRef = ref(this.db, this.chatsRoot);
    const newChatRef = push(chatRef);
    const chatId = newChatRef.key!;
    const participants = this.normalizeUserIds([userId1, userId2]);
    const timestamp = new Date().toISOString();

    const chat: Chat = {
      chatId,
      participants,
      lastMessage: '',
      lastMessageTime: timestamp,
      messages: {},
      type: 'direct',
    };

    await set(newChatRef, chat);

    // Add chat reference to both users
    await set(ref(this.db, `${this.userChatsRoot}/${userId1}/${chatId}`), true);
    await set(ref(this.db, `${this.userChatsRoot}/${userId2}/${chatId}`), true);
    const unreadCountByUser = participants.reduce<Record<string, number>>((acc, participantId) => {
      acc[participantId] = 0;
      return acc;
    }, {});
    await this.upsertChatSummary(chatId, chat, {
      unreadByUser: this.buildUnreadFlagsFromCounts(unreadCountByUser),
      unreadCountByUser,
      lastReadAtByUser: participants.reduce<Record<string, string>>((acc, participantId) => {
        acc[participantId] = timestamp;
        return acc;
      }, {}),
    });

    return chatId;
  }

  async ensureGroupChatForGroup(groupId: string): Promise<string> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      throw new Error('groupId is required.');
    }

    const callable = httpsCallable<
      EnsureGroupChatForGroupRequest,
      EnsureGroupChatForGroupResponse
    >(getFunctions(undefined, 'us-central1'), 'ensureGroupChatForGroup');
    const response = await callable({ groupId: normalizedGroupId });
    const chatId = this.normalizeString(response.data?.chatId);
    if (!chatId) {
      throw new Error('Group chat could not be created.');
    }
    return chatId;
  }

  // Get count of unread messages for a user
  async getUnreadMessageCount(userId: string): Promise<number> {
    try {
      // Get all user's chats
      const userChatsRef = ref(this.db, `${this.userChatsRoot}/${userId}`);
      const userChatsSnapshot = await get(userChatsRef);
      
      if (!userChatsSnapshot.exists()) {
        return 0;
      }
      
      let totalUnread = 0;
      const chatPromises: Promise<number>[] = [];
      
      // For each chat, check lightweight unread metadata only.
      userChatsSnapshot.forEach((childSnapshot) => {
        const chatId = childSnapshot.key!;
        const promise = new Promise<number>(async (resolve) => {
          const summarySnapshot = await get(ref(this.db, `${this.chatSummariesRoot}/${chatId}`));
          if (!summarySnapshot.exists()) {
            resolve(0);
            return;
          }

          const summaryData = summarySnapshot.val() as ChatSummaryRecord;
          resolve(this.resolveUnreadCount(summaryData, userId));
        });
        
        chatPromises.push(promise);
      });
      
      // Sum up all unread messages
      const results = await Promise.all(chatPromises);
      totalUnread = results.reduce((sum, count) => sum + count, 0);
      
      return totalUnread;
    } catch (error) {
      console.error('Error getting unread message count:', error);
      return 0;
    }
  }

  // Send a message in a chat
  async sendMessage(chatId: string, senderId: string, text: string): Promise<void> {
    await this.sendChatMessage(chatId, senderId, text, 'text');
  }

  async sendWorkoutSummaryMessage(chatId: string, senderId: string, text: string): Promise<void> {
    await this.sendChatMessage(chatId, senderId, text, 'workout_summary');
  }

  private async sendChatMessage(
    chatId: string,
    senderId: string,
    text: string,
    type: 'text' | 'workout_summary'
  ): Promise<void> {
    const messageRef = ref(this.db, `${this.chatsRoot}/${chatId}/messages`);
    const newMessageRef = push(messageRef);
    const timestamp = new Date().toISOString();

    const message: Message = {
      senderId,
      text,
      timestamp,
      read: false,
      type,
    };

    await set(newMessageRef, message);

    // Update last message
    const lastMessagePreview = type === 'workout_summary'
      ? 'Workout summary shared'
      : text;
    await set(ref(this.db, `${this.chatsRoot}/${chatId}/lastMessage`), lastMessagePreview);
    await set(ref(this.db, `${this.chatsRoot}/${chatId}/lastMessageTime`), timestamp);
    
    // Send push notifications to all recipients in the chat.
    try {
      const chatRef = ref(this.db, `${this.chatsRoot}/${chatId}`);
      const chatSnapshot = await get(chatRef);
      
      if (chatSnapshot.exists()) {
        const chatData = chatSnapshot.val() as Partial<Chat>;
        const participantIds = this.normalizeUserIds(chatData.participants);
        const unreadMetadata = await this.buildUnreadMetadataForIncomingMessage(
          chatId,
          participantIds,
          senderId,
          timestamp
        );
        await this.upsertChatSummary(chatId, chatData, {
          lastMessage: lastMessagePreview,
          lastMessageTime: timestamp,
          unreadByUser: unreadMetadata.unreadByUser,
          unreadCountByUser: unreadMetadata.unreadCountByUser,
          lastReadAtByUser: unreadMetadata.lastReadAtByUser,
        });

        const recipientIds = participantIds.filter((id) => id !== senderId);
        if (recipientIds.length === 0) {
          return;
        }

        const userProfile = this.userService.getUserInfo()();
        let senderName = 'Atlas';
        if (userProfile) {
          senderName = userProfile.firstName + ' ' + userProfile.lastName || 'Atlas';
        }

        await Promise.all(
          recipientIds.map(async (recipientId) => {
            const recipientAccountType =
              await this.userService.getResolvedAccountType(recipientId, 'trainer') ?? 'client';
            const unreadCount = await this.userService.incrementUnreadMessageCount(recipientId, recipientAccountType);

            await this.notificationService.sendNotification(
              recipientId,
              senderName,
              type === 'workout_summary'
                ? 'Shared a workout summary'
                : (text.length > 100 ? `${text.substring(0, 97)}...` : text),
              {
                type: 'chat',
                chatId,
                senderId,
                timestamp,
                badge: unreadCount,
              }
            );
          })
        );
      }   

    } catch (error) {
      // Log the error but don't fail the message send if notification fails
      console.error('Error sending notification:', error);
    }
  }

  async findOrCreateDirectChat(userId1: string, userId2: string): Promise<string> {
    const userChatsRef = ref(this.db, `${this.userChatsRoot}/${userId1}`);
    const userChatsSnapshot = await get(userChatsRef);

    if (userChatsSnapshot.exists()) {
      const chatIds = Object.keys(userChatsSnapshot.val() || {});
      for (const chatId of chatIds) {
        const chatSnapshot = await get(ref(this.db, `${this.chatsRoot}/${chatId}`));
        if (!chatSnapshot.exists()) continue;

        const chatData = chatSnapshot.val() as Chat;
        const participants = this.normalizeUserIds(chatData.participants);
        const isGroupChat = this.isGroupChat(chatData);
        if (!isGroupChat && participants.length === 2 && participants.includes(userId1) && participants.includes(userId2)) {
          return chatId;
        }
      }
    }

    return this.createChat(userId1, userId2);
  }

  async sendGroupInvite(
    chatId: string,
    senderId: string,
    targetUserId: string,
    groupId: string,
    groupName: string
  ): Promise<void> {
    const messageRef = ref(this.db, `${this.chatsRoot}/${chatId}/messages`);
    const newMessageRef = push(messageRef);
    const timestamp = new Date().toISOString();

    const message: Message = {
      senderId,
      text: `You've been invited to join ${groupName}.`,
      timestamp,
      read: false,
      type: 'group_invite',
      groupInvite: {
        groupId,
        groupName,
        inviterId: senderId,
        targetUserId,
        status: 'pending',
      },
    };

    await set(newMessageRef, message);
    const lastMessage = `Group invite: ${groupName}`;
    await set(ref(this.db, `${this.chatsRoot}/${chatId}/lastMessage`), lastMessage);
    await set(ref(this.db, `${this.chatsRoot}/${chatId}/lastMessageTime`), timestamp);

    const chatSnapshot = await get(ref(this.db, `${this.chatsRoot}/${chatId}`));
    if (chatSnapshot.exists()) {
      const chatData = chatSnapshot.val() as Partial<Chat>;
      const participants = this.normalizeUserIds(chatData.participants);
      const unreadMetadata = await this.buildUnreadMetadataForIncomingMessage(
        chatId,
        participants,
        senderId,
        timestamp
      );
      await this.upsertChatSummary(chatId, chatData, {
        lastMessage,
        lastMessageTime: timestamp,
        unreadByUser: unreadMetadata.unreadByUser,
        unreadCountByUser: unreadMetadata.unreadCountByUser,
        lastReadAtByUser: unreadMetadata.lastReadAtByUser,
      });
    }

    try {
      let senderName = 'Atlas';
      const userProfile = this.userService.getUserInfo()();
      if (userProfile) {
        senderName = userProfile.firstName + ' ' + userProfile.lastName || 'Atlas';
      }

      const senderAccountType =
        await this.userService.getResolvedAccountType(senderId, 'trainer') ?? 'client';
      const recipientAccountType: 'trainer' | 'client' = senderAccountType === 'trainer' ? 'client' : 'trainer';
      const unreadCount = await this.userService.incrementUnreadMessageCount(targetUserId, recipientAccountType);

      await this.notificationService.sendNotification(
        targetUserId,
        senderName,
        `Invited you to join ${groupName}`,
        {
          type: 'chat',
          chatId,
          senderId,
          timestamp,
          badge: unreadCount,
        }
      );
    } catch (error) {
      console.error('Error sending group invite notification:', error);
    }
  }

  async markGroupInviteAccepted(chatId: string, messageId: string, respondedBy: string): Promise<void> {
    const messageRef = ref(this.db, `${this.chatsRoot}/${chatId}/messages/${messageId}`);
    await update(messageRef, {
      'groupInvite/status': 'accepted',
      'groupInvite/respondedBy': respondedBy,
      'groupInvite/respondedAt': new Date().toISOString(),
      read: true,
    });
  }

  async sendJoinRequest(
    chatId: string,
    requesterId: string,
    requesterName: string,
    ownerUserId: string,
    groupId: string,
    groupName: string
  ): Promise<void> {
    const messageRef = ref(this.db, `${this.chatsRoot}/${chatId}/messages`);
    const newMessageRef = push(messageRef);
    const timestamp = new Date().toISOString();

    const text = `${requesterName} wants to join ${groupName}.`;
    const message: Message = {
      senderId: requesterId,
      text,
      timestamp,
      read: false,
      type: 'join_request',
      joinRequest: {
        groupId,
        groupName,
        requesterId,
        requesterName,
        targetOwnerId: ownerUserId,
        status: 'pending',
      },
    };

    await set(newMessageRef, message);
    await set(ref(this.db, `${this.chatsRoot}/${chatId}/lastMessage`), text);
    await set(ref(this.db, `${this.chatsRoot}/${chatId}/lastMessageTime`), timestamp);

    const chatSnapshot = await get(ref(this.db, `${this.chatsRoot}/${chatId}`));
    if (chatSnapshot.exists()) {
      const chatData = chatSnapshot.val() as Partial<Chat>;
      const participants = this.normalizeUserIds(chatData.participants);
      const unreadMetadata = await this.buildUnreadMetadataForIncomingMessage(
        chatId,
        participants,
        requesterId,
        timestamp
      );
      await this.upsertChatSummary(chatId, chatData, {
        lastMessage: text,
        lastMessageTime: timestamp,
        unreadByUser: unreadMetadata.unreadByUser,
        unreadCountByUser: unreadMetadata.unreadCountByUser,
        lastReadAtByUser: unreadMetadata.lastReadAtByUser,
      });
    }

    try {
      const senderAccountType =
        await this.userService.getResolvedAccountType(requesterId, 'trainer') ?? 'client';
      const recipientAccountType: 'trainer' | 'client' = senderAccountType === 'trainer' ? 'client' : 'trainer';
      const unreadCount = await this.userService.incrementUnreadMessageCount(ownerUserId, recipientAccountType);

      await this.notificationService.sendNotification(
        ownerUserId,
        requesterName,
        `Wants to join ${groupName}`,
        {
          type: 'chat',
          chatId,
          senderId: requesterId,
          timestamp,
          badge: unreadCount,
        }
      );
    } catch (error) {
      console.error('Error sending join request notification:', error);
    }
  }

  async markJoinRequestStatus(
    chatId: string,
    messageId: string,
    status: 'accepted' | 'declined',
    respondedBy: string
  ): Promise<void> {
    const messageRef = ref(this.db, `${this.chatsRoot}/${chatId}/messages/${messageId}`);
    await update(messageRef, {
      'joinRequest/status': status,
      'joinRequest/respondedBy': respondedBy,
      'joinRequest/respondedAt': new Date().toISOString(),
      read: true,
    });
  }

  // Initialize user chats
  initializeUserChats(userId: string, userType: 'trainer' | 'client'): void {
    const nextUserKey = `${userId}:${userType}`;
    if (this.initialized && this.initializedUserKey === nextUserKey) {
      return;
    }

    this.teardownListeners();
    this.chatCache.clear();
    this.initialized = true;
    this.initializedUserKey = nextUserKey;

    const userChatsRef = ref(this.db, `${this.userChatsRoot}/${userId}`);

    this.userChatsUnsubscribe = onValue(userChatsRef, (snapshot) => {
      const nextChatIds = new Set<string>();
      snapshot.forEach((childSnapshot) => {
        const chatId = childSnapshot.key;
        if (chatId) {
          nextChatIds.add(chatId);
        }
      });

      for (const [chatId, unsubscribe] of this.chatUnsubscribes) {
        if (!nextChatIds.has(chatId)) {
          unsubscribe();
          this.chatUnsubscribes.delete(chatId);
          this.chatCache.delete(chatId);
        }
      }

      for (const chatId of nextChatIds) {
        if (!this.chatUnsubscribes.has(chatId)) {
          this.attachChatSummaryListener(chatId, userId, userType);
        }
      }

      this.emitChats();
    });
  }

  private attachChatSummaryListener(chatId: string, userId: string, userType: 'trainer' | 'client'): void {
    const summaryRef = ref(this.db, `${this.chatSummariesRoot}/${chatId}`);
    const unsubscribe = onValue(summaryRef, (summarySnapshot) => {
      if (!summarySnapshot.exists()) {
        this.chatCache.delete(chatId);
        this.emitChats();
        void this.bootstrapChatSummary(chatId);
        return;
      }

      const summary = summarySnapshot.val() as ChatSummaryRecord;
      const participants = this.normalizeUserIds(summary.participants);
      const normalizedLastMessageTime = this.normalizeString(summary.lastMessageTime) || new Date(0).toISOString();

      const chatData: Chat = {
        chatId,
        participants,
        lastMessage: this.normalizeString(summary.lastMessage),
        lastMessageTime: normalizedLastMessageTime,
        type: summary.type === 'group' ? 'group' : 'direct',
        groupId: this.normalizeString(summary.groupId),
        displayName: this.normalizeString(summary.displayName),
        groupImage: this.normalizeString(summary.groupImage),
        isGroupChat: summary.isGroupChat === true || summary.type === 'group' || !!this.normalizeString(summary.groupId),
        unreadByUser: this.normalizeBooleanMap(summary.unreadByUser),
        unreadCountByUser: this.normalizeWholeNumberMap(summary.unreadCountByUser),
        lastReadAtByUser: this.normalizeStringMap(summary.lastReadAtByUser),
        hasUnreadMessages: this.resolveUnreadCount(summary, userId) > 0,
      };

      if (chatData.isGroupChat) {
        chatData.displayName = chatData.displayName || 'Group Chat';
      } else {
        const otherUserId = participants.find((id: string) => id !== userId);
        if (otherUserId) {
          const otherUserType = userType === 'trainer' ? 'client' : 'trainer';
          chatData.displayName = chatData.displayName || 'User';
          chatData.userProfile = this.getUserProfileSignal(otherUserId, otherUserType);
          void this.hydrateDirectChatMetadata(chatId, otherUserId, otherUserType);
        }
      }

      this.chatCache.set(chatId, chatData);
      this.emitChats();
    });

    this.chatUnsubscribes.set(chatId, unsubscribe);
  }

  private async bootstrapChatSummary(chatId: string): Promise<void> {
    const normalizedChatId = this.normalizeString(chatId);
    if (!normalizedChatId || this.chatSummaryBootstrapInFlight.has(normalizedChatId)) {
      return;
    }

    this.chatSummaryBootstrapInFlight.add(normalizedChatId);
    try {
      const chatSnapshot = await get(ref(this.db, `${this.chatsRoot}/${normalizedChatId}`));
      if (!chatSnapshot.exists()) {
        return;
      }

      const chatData = chatSnapshot.val() as Partial<Chat>;
      const participants = this.normalizeUserIds(chatData.participants);
      const timestamp = this.normalizeString(chatData.lastMessageTime) || new Date().toISOString();
      const unreadCountByUser = participants.reduce<Record<string, number>>((acc, participantId) => {
        acc[participantId] = 0;
        return acc;
      }, {});
      const unreadByUser = participants.reduce<Record<string, boolean>>((acc, participantId) => {
        acc[participantId] = false;
        return acc;
      }, {});

      await this.upsertChatSummary(normalizedChatId, chatData, {
        unreadByUser,
        unreadCountByUser,
        lastReadAtByUser: participants.reduce<Record<string, string>>((acc, participantId) => {
          acc[participantId] = timestamp;
          return acc;
        }, {}),
      });
    } catch (error) {
      console.warn('[ChatsService] Failed to bootstrap chat summary:', normalizedChatId, error);
    } finally {
      this.chatSummaryBootstrapInFlight.delete(normalizedChatId);
    }
  }

  private emitChats(): void {
    const chats = Array.from(this.chatCache.values()).sort((a, b) => {
      const aTime = Date.parse(a.lastMessageTime || '') || 0;
      const bTime = Date.parse(b.lastMessageTime || '') || 0;
      return bTime - aTime;
    });
    this.chatsSubject.next(chats);
  }

  private async hydrateDirectChatMetadata(
    chatId: string,
    otherUserId: string,
    preferredAccountType: 'trainer' | 'client'
  ): Promise<void> {
    const normalizedChatId = this.normalizeString(chatId);
    const normalizedOtherUserId = this.normalizeString(otherUserId);
    if (!normalizedChatId || !normalizedOtherUserId) {
      return;
    }

    try {
      const preferredProfile = await this.userService.getUserProfileDirectly(
        normalizedOtherUserId,
        preferredAccountType
      );
      const resolvedProfile =
        preferredProfile ??
        await this.userService.getUserProfileDirectly(
          normalizedOtherUserId,
          preferredAccountType === 'trainer' ? 'client' : 'trainer'
        );

      const cachedChat = this.chatCache.get(normalizedChatId);
      if (!cachedChat || cachedChat.isGroupChat) {
        return;
      }

      const fullName = `${String(resolvedProfile?.firstName || '').trim()} ${String(
        resolvedProfile?.lastName || ''
      ).trim()}`.trim();
      const profilepic = String(
        resolvedProfile?.profilepic ||
        ''
      ).trim();

      const nextChat: Chat = {
        ...cachedChat,
        displayName: fullName || cachedChat.displayName || 'User',
        profilepic: profilepic || cachedChat.profilepic || '',
      };

      this.chatCache.set(normalizedChatId, nextChat);
      this.emitChats();
    } catch (error) {
      console.warn('[ChatsService] Failed to hydrate direct chat metadata:', normalizedChatId, error);
    }
  }

  private teardownListeners(): void {
    this.userChatsUnsubscribe?.();
    this.userChatsUnsubscribe = null;

    for (const unsubscribe of this.chatUnsubscribes.values()) {
      unsubscribe();
    }
    this.chatUnsubscribes.clear();
  }

  private getUserProfileSignal(userId: string, userType: 'trainer' | 'client') {
    const key = `${userType}:${userId}`;
    const cached = this.profileSignalCache.get(key);
    if (cached) {
      return cached;
    }

    const signalRef = this.userService.getUserById(userId, userType);
    this.profileSignalCache.set(key, signalRef);
    return signalRef;
  }
  
  // Reset initialization state (useful when logging out/switching users)
  resetInitialization(): void {
    this.teardownListeners();
    this.initialized = false;
    this.initializedUserKey = null;
    this.chatSummaryBootstrapInFlight.clear();
    this.chatCache.clear();
    this.profileSignalCache.clear();
    this.chatsSubject.next([]);
  }

  /**
   * Reset the unread message count for a user
   * @param userId The user ID to reset the unread message count for
   */
  async resetUnreadMessageCount(userId: string): Promise<void> {
    try {
      // Determine the user's account type by checking trainer first
      const accountType =
        await this.userService.getResolvedAccountType(userId, 'trainer') ?? 'client';
      
      // Reset the unread message count in the user's profile
      await this.userService.resetUnreadMessageCount(userId, accountType);
    } catch (error) {
      console.error('Error resetting unread message count:', error);
    }
  }

  /**
   * Reset the badge count for a user by updating their profile and sending a silent notification
   * @param userId The user ID to reset the badge for
   */
  async resetBadgeCount(userId: string): Promise<void> {
    try {
      // Determine the user's account type by checking trainer first
      const accountType =
        await this.userService.getResolvedAccountType(userId, 'trainer') ?? 'client';
      
      // Reset the unread message count in the user's profile
      await this.userService.resetUnreadMessageCount(userId, accountType);
      
      // Send a silent notification to reset the badge count
      await this.notificationService.sendNotification(
        userId,
        'Atlas', // Non-empty title for notification (won't be displayed for silent notifications)
        'Badge Reset', // Non-empty body for notification (won't be displayed for silent notifications)
        {
          type: 'badge_reset',
          badge: 0, // Reset badge to 0
          silent: true // Mark as silent notification
        }
      );
    } catch (error) {
      console.error('Error resetting badge count:', error);
    }
  }

  /**
   * Mark all unread messages from a specific sender as read
   * @param chatId The chat ID containing the messages
   * @param currentUserId The current user's ID
   */
  async markAllMessagesAsRead(chatId: string, currentUserId: string): Promise<void> {
    try {
      const unreadMessagesCleared = await this.markChatSummaryAsRead(chatId, currentUserId);
      if (unreadMessagesCleared > 0) {
        await this.adjustUnreadBadgeCount(currentUserId, -unreadMessagesCleared);
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }

  /**
   * Find an existing chat between two users
   * @param userId1 First user ID
   * @param userId2 Second user ID
   * @returns The chat ID if a chat exists, null otherwise
   */
  async findExistingChatBetweenUsers(userId1: string, userId2: string): Promise<string | null> {
    // Get all chats for the first user
    const userChatsRef = ref(this.db, `${this.userChatsRoot}/${userId1}`);
    const userChatsSnapshot = await get(userChatsRef);
    
    if (!userChatsSnapshot.exists()) {
      return null; // No chats found for this user
    }
    
    // For each chat, check if the second user is a participant
    const chatPromises: Promise<any>[] = [];
    userChatsSnapshot.forEach((childSnapshot) => {
      const chatId = childSnapshot.key!;
      const chatRef = ref(this.db, `${this.chatsRoot}/${chatId}`);
      chatPromises.push(get(chatRef));
    });
    
    const chatSnapshots = await Promise.all(chatPromises);
    
    // Find a chat where both users are participants
    for (const chatSnapshot of chatSnapshots) {
      if (chatSnapshot.exists()) {
        const chatData = chatSnapshot.val() as Chat;
        const participants = this.normalizeUserIds(chatData.participants);
        const isGroupChat = this.isGroupChat(chatData);
        
        if (!isGroupChat && participants.length === 2 && participants.includes(userId1) && participants.includes(userId2)) {
          return chatSnapshot.key;
        }
      }
    }
    
    return null; // No existing chat found between these users
  }

  /**
   * Check if a user has any conversations
   * @param userId The user ID to check
   * @returns Promise<boolean> True if the user has any conversations, false otherwise
   */
  async hasConversations(userId: string): Promise<boolean> {
    try {
      const userChatsRef = ref(this.db, `${this.userChatsRoot}/${userId}`);
      const userChatsSnapshot = await get(userChatsRef);
      
      // If the userChats node exists and has children, the user has conversations
      return userChatsSnapshot.exists() && Object.keys(userChatsSnapshot.val()).length > 0;
    } catch (error) {
      console.error('Error checking if user has conversations:', error);
      // Default to true in case of error to avoid unnecessary redirects
      return true;
    }
  }

  private async adjustUnreadBadgeCount(userId: string, delta: number): Promise<void> {
    const normalizedUserId = this.normalizeString(userId);
    if (!normalizedUserId || !Number.isFinite(delta) || delta === 0) {
      return;
    }

    try {
      const accountType =
        await this.userService.getResolvedAccountType(normalizedUserId, 'trainer') ?? 'client';
      const nextUnreadCount = await this.userService.adjustUnreadMessageCount(
        normalizedUserId,
        accountType,
        delta
      );

      await this.notificationService.sendNotification(
        normalizedUserId,
        'Atlas',
        'Badge Update',
        {
          type: 'badge_reset',
          badge: nextUnreadCount,
          silent: true
        }
      );
    } catch (error) {
      console.warn('[ChatsService] Failed to adjust unread badge count:', normalizedUserId, error);
    }
  }

  private async buildUnreadMetadataForIncomingMessage(
    chatId: string,
    participantsInput: string[],
    senderId: string,
    timestamp: string
  ): Promise<{
    unreadByUser: Record<string, boolean>;
    unreadCountByUser: Record<string, number>;
    lastReadAtByUser: Record<string, string>;
  }> {
    const participants = this.normalizeUserIds(participantsInput);
    const normalizedSenderId = this.normalizeString(senderId);
    const normalizedTimestamp = this.normalizeString(timestamp) || new Date().toISOString();

    const summarySnapshot = await get(ref(this.db, `${this.chatSummariesRoot}/${chatId}`));
    const summaryData = summarySnapshot.exists()
      ? (summarySnapshot.val() as ChatSummaryRecord)
      : undefined;

    const currentUnreadByUser = this.buildUnreadCountsFromValues(
      participants,
      summaryData?.unreadCountByUser,
      summaryData?.unreadByUser
    );

    const unreadCountByUser = participants.reduce<Record<string, number>>((acc, participantId) => {
      if (participantId === normalizedSenderId) {
        acc[participantId] = 0;
        return acc;
      }

      acc[participantId] = (currentUnreadByUser[participantId] ?? 0) + 1;
      return acc;
    }, {});

    const lastReadAtByUser = this.normalizeStringMap(summaryData?.lastReadAtByUser);
    if (normalizedSenderId) {
      lastReadAtByUser[normalizedSenderId] = normalizedTimestamp;
    }

    return {
      unreadByUser: this.buildUnreadFlagsFromCounts(unreadCountByUser),
      unreadCountByUser,
      lastReadAtByUser,
    };
  }

  private async markChatSummaryAsRead(chatId: string, userId: string): Promise<number> {
    const normalizedChatId = this.normalizeString(chatId);
    const normalizedUserId = this.normalizeString(userId);
    if (!normalizedChatId || !normalizedUserId) {
      return 0;
    }

    try {
      const summaryRef = ref(this.db, `${this.chatSummariesRoot}/${normalizedChatId}`);
      const summarySnapshot = await get(summaryRef);
      const summaryData = summarySnapshot.exists()
        ? (summarySnapshot.val() as ChatSummaryRecord)
        : undefined;
      const currentUnread = this.resolveUnreadCount(summaryData, normalizedUserId);
      const timestamp = new Date().toISOString();

      await update(ref(this.db, `${this.chatSummariesRoot}/${normalizedChatId}`), {
        [`unreadByUser/${normalizedUserId}`]: false,
        [`unreadCountByUser/${normalizedUserId}`]: 0,
        [`lastReadAtByUser/${normalizedUserId}`]: timestamp,
      });
      return currentUnread;
    } catch (error) {
      console.warn('[ChatsService] Failed to mark chat summary as read:', normalizedChatId, error);
      return 0;
    }
  }

  private async upsertChatSummary(
    chatId: string,
    chatData: Partial<Chat>,
    options?: {
      lastMessage?: string;
      lastMessageTime?: string;
      unreadByUser?: Record<string, boolean>;
      unreadCountByUser?: Record<string, number>;
      lastReadAtByUser?: Record<string, string>;
    }
  ): Promise<void> {
    const normalizedChatId = this.normalizeString(chatId);
    if (!normalizedChatId) {
      return;
    }

    const participants = this.normalizeUserIds(chatData.participants);
    const isGroup = this.isGroupChat(chatData);
    const lastMessage = this.normalizeString(options?.lastMessage ?? chatData.lastMessage);
    const lastMessageTime =
      this.normalizeString(options?.lastMessageTime ?? chatData.lastMessageTime) ||
      new Date().toISOString();

    const unreadCountByUser = this.buildUnreadCountsFromValues(
      participants,
      options?.unreadCountByUser ?? chatData.unreadCountByUser,
      options?.unreadByUser ?? chatData.unreadByUser
    );

    const summaryUpdate: Partial<ChatSummaryRecord> = {
      chatId: normalizedChatId,
      participants,
      lastMessage,
      lastMessageTime,
      type: isGroup ? 'group' : 'direct',
      isGroupChat: isGroup,
      unreadByUser: this.buildUnreadFlagsFromCounts(unreadCountByUser),
      unreadCountByUser,
      lastReadAtByUser:
        options?.lastReadAtByUser ??
        this.normalizeStringMap(chatData.lastReadAtByUser),
    };

    if (isGroup) {
      summaryUpdate.groupId = this.normalizeString(chatData.groupId);
      summaryUpdate.displayName = this.normalizeString(chatData.displayName) || 'Group Chat';
      summaryUpdate.groupImage = this.normalizeString(chatData.groupImage);
    }

    await update(ref(this.db, `${this.chatSummariesRoot}/${normalizedChatId}`), summaryUpdate as Record<string, unknown>);
  }

  private resolveUnreadCount(
    summary: Partial<ChatSummaryRecord> | undefined,
    userId: string
  ): number {
    const normalizedUserId = this.normalizeString(userId);
    if (!normalizedUserId) {
      return 0;
    }

    const unreadCountMap = this.normalizeWholeNumberMap(summary?.unreadCountByUser);
    if (Object.prototype.hasOwnProperty.call(unreadCountMap, normalizedUserId)) {
      return unreadCountMap[normalizedUserId] ?? 0;
    }

    const unreadFlagMap = this.normalizeBooleanMap(summary?.unreadByUser);
    return unreadFlagMap[normalizedUserId] === true ? 1 : 0;
  }

  private normalizeBooleanMap(value: unknown): Record<string, boolean> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const normalized: Record<string, boolean> = {};
    Object.entries(value as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
      const key = this.normalizeString(rawKey);
      if (!key) {
        return;
      }

      normalized[key] = rawValue === true;
    });
    return normalized;
  }

  private normalizeWholeNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const normalized: Record<string, number> = {};
    Object.entries(value as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
      const key = this.normalizeString(rawKey);
      if (!key) {
        return;
      }

      const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (!Number.isFinite(parsed)) {
        normalized[key] = 0;
        return;
      }

      normalized[key] = Math.max(0, Math.trunc(parsed));
    });
    return normalized;
  }

  private normalizeStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const normalized: Record<string, string> = {};
    Object.entries(value as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
      const key = this.normalizeString(rawKey);
      const mappedValue = this.normalizeString(rawValue);
      if (!key || !mappedValue) {
        return;
      }

      normalized[key] = mappedValue;
    });

    return normalized;
  }

  private buildUnreadCountsFromValues(
    participants: string[],
    unreadCountValue: unknown,
    unreadByUserValue: unknown
  ): Record<string, number> {
    const normalizedParticipants = this.normalizeUserIds(participants);
    const unreadCountMap = this.normalizeWholeNumberMap(unreadCountValue);
    const unreadFlagMap = this.normalizeBooleanMap(unreadByUserValue);

    return normalizedParticipants.reduce<Record<string, number>>((acc, participantId) => {
      if (Object.prototype.hasOwnProperty.call(unreadCountMap, participantId)) {
        acc[participantId] = unreadCountMap[participantId] ?? 0;
        return acc;
      }

      acc[participantId] = unreadFlagMap[participantId] === true ? 1 : 0;
      return acc;
    }, {});
  }

  private buildUnreadFlagsFromCounts(unreadCountByUser: Record<string, number>): Record<string, boolean> {
    const unreadFlags: Record<string, boolean> = {};
    Object.entries(this.normalizeWholeNumberMap(unreadCountByUser)).forEach(([userId, unreadCount]) => {
      unreadFlags[userId] = unreadCount > 0;
    });
    return unreadFlags;
  }

  private isGroupChat(chat: Partial<Chat> | null | undefined): boolean {
    if (!chat) {
      return false;
    }

    const participants = this.normalizeUserIds(chat.participants);
    return chat.type === 'group' || !!this.normalizeString(chat.groupId) || participants.length > 2;
  }

  private normalizeUserIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const uniqueIds = new Set<string>();
    for (const entry of value) {
      const normalized = this.normalizeString(entry);
      if (normalized) {
        uniqueIds.add(normalized);
      }
    }

    return Array.from(uniqueIds);
  }

  private normalizeString(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }
}
