import { Injectable } from '@angular/core';
import { Database, ref, push, set, onValue, query, orderByChild, get, update } from '@angular/fire/database';
import { Observable, BehaviorSubject } from 'rxjs';
import { Chat, Message } from '../Interfaces/Chats';
import { UserService } from './account/user.service';
import { NotificationService } from './notification.service';

@Injectable({
  providedIn: 'root'
})
export class ChatsService {
  private chatsSubject = new BehaviorSubject<Chat[]>([]);
  public chats$ = this.chatsSubject.asObservable();
  private initialized = false;
  private initializedUserKey: string | null = null;
  private userChatsUnsubscribe: (() => void) | null = null;
  private chatUnsubscribes = new Map<string, () => void>();
  private chatCache = new Map<string, Chat>();
  private profileSignalCache = new Map<string, ReturnType<UserService['getUserById']>>();
  
  constructor(
    private db: Database, 
    private userService: UserService, 
    private notificationService: NotificationService
  ) { }

  // Create a new chat between two users
  async createChat(userId1: string, userId2: string): Promise<string> {
    const chatRef = ref(this.db, 'chats');
    const newChatRef = push(chatRef);
    const chatId = newChatRef.key!;

    const chat: Chat = {
      chatId,
      participants: [userId1, userId2],
      lastMessage: '',
      lastMessageTime: new Date().toISOString(),
      messages: {}
    };

    await set(newChatRef, chat);

    // Add chat reference to both users
    await set(ref(this.db, `userChats/${userId1}/${chatId}`), true);
    await set(ref(this.db, `userChats/${userId2}/${chatId}`), true);

    return chatId;
  }

  // Get count of unread messages for a user
  async getUnreadMessageCount(userId: string): Promise<number> {
    try {
      // Get all user's chats
      const userChatsRef = ref(this.db, `userChats/${userId}`);
      const userChatsSnapshot = await get(userChatsRef);
      
      if (!userChatsSnapshot.exists()) {
        return 0;
      }
      
      let totalUnread = 0;
      const chatPromises: Promise<number>[] = [];
      
      // For each chat, count unread messages
      userChatsSnapshot.forEach((childSnapshot) => {
        const chatId = childSnapshot.key!;
        const promise = new Promise<number>(async (resolve) => {
          const messagesRef = ref(this.db, `chats/${chatId}/messages`);
          const messagesSnapshot = await get(messagesRef);
          
          let chatUnread = 0;
          if (messagesSnapshot.exists()) {
            // Count messages that are from others and unread
            messagesSnapshot.forEach((messageSnapshot) => {
              const message = messageSnapshot.val();
              if (message.senderId !== userId && !message.read) {
                chatUnread++;
              }
            });
          }
          resolve(chatUnread);
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
    const messageRef = ref(this.db, `chats/${chatId}/messages`);
    const newMessageRef = push(messageRef);

    const message: Message = {
      senderId,
      text,
      timestamp: new Date().toISOString(),
      read: false
    };

    await set(newMessageRef, message);

    // Update last message
    await set(ref(this.db, `chats/${chatId}/lastMessage`), text);
    await set(ref(this.db, `chats/${chatId}/lastMessageTime`), message.timestamp);
    
    // Send push notification to the recipient
    try {
      // Get chat details to find the recipient
      const chatRef = ref(this.db, `chats/${chatId}`);
      const chatSnapshot = await get(chatRef);
      
      if (chatSnapshot.exists()) {
        const chatData = chatSnapshot.val();
        
        // Find the recipient (the user who is not the sender)
        const recipientId = chatData.participants.find((id: string) => id !== senderId);
        
        if (recipientId) {
          // Get sender's name to include in the notification
          const userProfile = this.userService.getUserInfo()();
          
          // Default sender name if we can't get the profile
          let senderName = 'Atlas';
          
          // If we have the user profile, use their name
          if (userProfile) {
            senderName = userProfile.firstName + ' ' + userProfile.lastName || 'Atlas';
          }
          
          // Determine recipient's account type (always opposite of sender)
          const senderProfile = await this.userService.getUserProfileDirectly(senderId, 'trainer');
          const senderAccountType: 'trainer' | 'client' = senderProfile ? 'trainer' : 'client';
          const recipientAccountType: 'trainer' | 'client' = senderAccountType === 'trainer' ? 'client' : 'trainer';
          
          // Increment unread message count and get the new count for badge
          const unreadCount = await this.userService.incrementUnreadMessageCount(recipientId, recipientAccountType);
          
          // Send the notification with sender name as title and message as body
          await this.notificationService.sendNotification(
            recipientId,
            senderName, // Just the sender's name as the title
            text.length > 100 ? `${text.substring(0, 97)}...` : text, // Message content as body
            {
              type: 'chat',
              chatId: chatId,
              senderId: senderId,
              timestamp: message.timestamp,
              badge: unreadCount // Include the badge count
            }
          );
        }
      }   

    } catch (error) {
      // Log the error but don't fail the message send if notification fails
      console.error('Error sending notification:', error);
    }
  }

  async findOrCreateDirectChat(userId1: string, userId2: string): Promise<string> {
    const userChatsRef = ref(this.db, `userChats/${userId1}`);
    const userChatsSnapshot = await get(userChatsRef);

    if (userChatsSnapshot.exists()) {
      const chatIds = Object.keys(userChatsSnapshot.val() || {});
      for (const chatId of chatIds) {
        const chatSnapshot = await get(ref(this.db, `chats/${chatId}`));
        if (!chatSnapshot.exists()) continue;

        const chatData = chatSnapshot.val() as Chat;
        const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
        if (participants.includes(userId1) && participants.includes(userId2)) {
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
    const messageRef = ref(this.db, `chats/${chatId}/messages`);
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
    await set(ref(this.db, `chats/${chatId}/lastMessage`), `Group invite: ${groupName}`);
    await set(ref(this.db, `chats/${chatId}/lastMessageTime`), timestamp);

    try {
      let senderName = 'Atlas';
      const userProfile = this.userService.getUserInfo()();
      if (userProfile) {
        senderName = userProfile.firstName + ' ' + userProfile.lastName || 'Atlas';
      }

      const senderProfile = await this.userService.getUserProfileDirectly(senderId, 'trainer');
      const senderAccountType: 'trainer' | 'client' = senderProfile ? 'trainer' : 'client';
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
    const messageRef = ref(this.db, `chats/${chatId}/messages/${messageId}`);
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
    const messageRef = ref(this.db, `chats/${chatId}/messages`);
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
    await set(ref(this.db, `chats/${chatId}/lastMessage`), text);
    await set(ref(this.db, `chats/${chatId}/lastMessageTime`), timestamp);

    try {
      const senderProfile = await this.userService.getUserProfileDirectly(requesterId, 'trainer');
      const senderAccountType: 'trainer' | 'client' = senderProfile ? 'trainer' : 'client';
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
    const messageRef = ref(this.db, `chats/${chatId}/messages/${messageId}`);
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

    const userChatsRef = ref(this.db, `userChats/${userId}`);

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
          this.attachChatListener(chatId, userId, userType);
        }
      }

      this.emitChats();
    });
  }

  private attachChatListener(chatId: string, userId: string, userType: 'trainer' | 'client'): void {
    const chatRef = ref(this.db, `chats/${chatId}`);
    const unsubscribe = onValue(chatRef, (chatSnapshot) => {
      if (!chatSnapshot.exists()) {
        this.chatCache.delete(chatId);
        this.emitChats();
        return;
      }

      const chatData = { ...chatSnapshot.val(), chatId } as Chat & {
        userProfile?: ReturnType<UserService['getUserById']>;
        hasUnreadMessages?: boolean;
      };

      const otherUserId = chatData.participants?.find((id: string) => id !== userId);
      if (otherUserId) {
        const otherUserType = userType === 'trainer' ? 'client' : 'trainer';
        chatData.userProfile = this.getUserProfileSignal(otherUserId, otherUserType);
      }

      let hasUnreadMessages = false;
      if (chatData.messages) {
        Object.values(chatData.messages).forEach((message: any) => {
          if (message.senderId !== userId && !message.read) {
            hasUnreadMessages = true;
          }
        });
      }
      chatData.hasUnreadMessages = hasUnreadMessages;

      this.chatCache.set(chatId, chatData);
      this.emitChats();
    });

    this.chatUnsubscribes.set(chatId, unsubscribe);
  }

  private emitChats(): void {
    const chats = Array.from(this.chatCache.values()).sort((a, b) => {
      const aTime = Date.parse(a.lastMessageTime || '') || 0;
      const bTime = Date.parse(b.lastMessageTime || '') || 0;
      return bTime - aTime;
    });
    this.chatsSubject.next(chats);
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
    this.chatCache.clear();
    this.profileSignalCache.clear();
    this.chatsSubject.next([]);
  }

  // Get messages for a specific chat
  getChatMessages(chatId: string): Observable<Message[]> {
    const messagesRef = ref(this.db, `chats/${chatId}/messages`);
    const messagesQuery = query(messagesRef, orderByChild('timestamp'));

    return new Observable(subscriber => {
      const unsubscribe = onValue(messagesQuery, (snapshot) => {
        const messages: Message[] = [];
        snapshot.forEach((childSnapshot) => {
          const message: Message = {
            ...childSnapshot.val(),
            messageId: childSnapshot.key
          };
          messages.push(message);
        });
        subscriber.next(messages);
      });

      return () => unsubscribe();
    });
  }

  // Mark messages as read
  async markMessagesAsRead(chatId: string, messageIds: string[]): Promise<void> {
    // Update each message individually
    const updatePromises = messageIds.map(messageId => 
      set(
        ref(this.db, `chats/${chatId}/messages/${messageId}/read`),
        true
      )
    );
  
    // Wait for all updates to complete
    await Promise.all(updatePromises);
  }
  
  /**
   * Reset the unread message count for a user
   * @param userId The user ID to reset the unread message count for
   */
  async resetUnreadMessageCount(userId: string): Promise<void> {
    try {
      // Determine the user's account type by checking trainer first
      const trainerProfile = await this.userService.getUserProfileDirectly(userId, 'trainer');
      const accountType: 'trainer' | 'client' = trainerProfile ? 'trainer' : 'client';
      
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
      const trainerProfile = await this.userService.getUserProfileDirectly(userId, 'trainer');
      const accountType: 'trainer' | 'client' = trainerProfile ? 'trainer' : 'client';
      
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
      // Get all messages in the chat
      const messagesRef = ref(this.db, `chats/${chatId}/messages`);
      const messagesSnapshot = await get(messagesRef);
      
      if (!messagesSnapshot.exists()) return;
      
      const updatePromises: Promise<void>[] = [];
      let hadUnreadMessages = false;
      
      // Find all unread messages from other participants
      messagesSnapshot.forEach((childSnapshot) => {
        const messageId = childSnapshot.key!;
        const message = childSnapshot.val();
        
        // Only mark messages from other users as read
        if (message.senderId !== currentUserId && !message.read) {
          hadUnreadMessages = true;
          updatePromises.push(
            set(ref(this.db, `chats/${chatId}/messages/${messageId}/read`), true)
          );
        }
      });
      
      // Update all messages at once
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        
        // If we had unread messages, reset the badge count
        if (hadUnreadMessages) {
          // Reset the badge count for the current user
          await this.resetBadgeCount(currentUserId);
        }
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
    const userChatsRef = ref(this.db, `userChats/${userId1}`);
    const userChatsSnapshot = await get(userChatsRef);
    
    if (!userChatsSnapshot.exists()) {
      return null; // No chats found for this user
    }
    
    // For each chat, check if the second user is a participant
    const chatPromises: Promise<any>[] = [];
    userChatsSnapshot.forEach((childSnapshot) => {
      const chatId = childSnapshot.key!;
      const chatRef = ref(this.db, `chats/${chatId}`);
      chatPromises.push(get(chatRef));
    });
    
    const chatSnapshots = await Promise.all(chatPromises);
    
    // Find a chat where both users are participants
    for (const chatSnapshot of chatSnapshots) {
      if (chatSnapshot.exists()) {
        const chatData = chatSnapshot.val();
        const participants = chatData.participants || [];
        
        if (participants.includes(userId1) && participants.includes(userId2)) {
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
      const userChatsRef = ref(this.db, `userChats/${userId}`);
      const userChatsSnapshot = await get(userChatsRef);
      
      // If the userChats node exists and has children, the user has conversations
      return userChatsSnapshot.exists() && Object.keys(userChatsSnapshot.val()).length > 0;
    } catch (error) {
      console.error('Error checking if user has conversations:', error);
      // Default to true in case of error to avoid unnecessary redirects
      return true;
    }
  }
}
