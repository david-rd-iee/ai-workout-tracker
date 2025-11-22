import { Injectable } from '@angular/core';
import { Database, ref, push, set, onValue, query, orderByChild, get } from '@angular/fire/database';
import { firstValueFrom, Observable, BehaviorSubject } from 'rxjs';
import { Chat, ChatRequest, Message } from '../Interfaces/Chats';
import { UserService } from './account/user.service';
import { AccountService } from './account/account.service';
import { NotificationService } from './notification.service';

@Injectable({
  providedIn: 'root'
})
export class ChatsService {
  private chatsSubject = new BehaviorSubject<Chat[]>([]);
  public chats$ = this.chatsSubject.asObservable();
  private initialized = false;
  
  constructor(
    private db: Database, 
    private userService: UserService, 
    private accountService: AccountService,
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
    console.log('Sending message:', text, chatId, senderId);
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
          const currentUser = this.userService.getCurrentUser()();
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
          console.log(`Incremented unread message count for ${recipientId} (${recipientAccountType}) to: ${unreadCount}`);
          
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
          
          console.log(`Notification sent to user ${recipientId} with badge count ${unreadCount}`);
        }
      }   

    } catch (error) {
      // Log the error but don't fail the message send if notification fails
      console.error('Error sending notification:', error);
    }
  }

  // Initialize user chats
  initializeUserChats(userId: string, userType: 'trainer' | 'client'): void {
    // Guard clause to prevent multiple initializations
    if (this.initialized) return;
      
    // Create reference to user's chats in Firebase
    const userChatsRef = ref(this.db, `userChats/${userId}`);
      
    // Listen for changes to user's chats
    onValue(userChatsRef, (snapshot) => {
      const chats: Chat[] = [];
      const promises: Promise<void>[] = [];
  
      // For each chat ID in userChats
      snapshot.forEach((childSnapshot) => {
        const chatId = childSnapshot.key!;
          
        // Create a promise to fetch each chat's details
        const promise = new Promise<void>((resolve) => {
          const chatRef = ref(this.db, `chats/${chatId}`);
          // Get chat data
          onValue(chatRef, (chatSnapshot) => {
            if (chatSnapshot.exists()) {
              // Find if chat already exists in array
              const existingChatIndex = chats.findIndex(c => c.chatId === chatId);
              const chatData = { ...chatSnapshot.val(), chatId };
              
              // Get the other participant's ID (not the current user)
              const otherUserId = chatData.participants.find((id: string) => id !== userId);
              if (otherUserId) {
                // Determine if the other user is a trainer or client
                // Since we're in a chat, if current user is trainer, other must be client and vice versa
                const otherUserType = userType === 'trainer' ? 'client' : 'trainer';
                
                // Get the other user's profile
                chatData.userProfile = this.userService.getUserById(otherUserId, otherUserType);
              }
              
              // Check for unread messages
              chatData.hasUnreadMessages = false;
              if (chatData.messages) {
                // Check if there are any unread messages from the other user
                Object.values(chatData.messages).forEach((message: any) => {
                  if (message.senderId !== userId && !message.read) {
                    chatData.hasUnreadMessages = true;
                  }
                });
              }
                
              // Update or add chat to array
              if (existingChatIndex > -1) {
                chats[existingChatIndex] = chatData;
              } else {
                chats.push(chatData);
              }
            }
            resolve();
          });
        });
          
        promises.push(promise);
      });
  
      // When all chat data is fetched, update the BehaviorSubject
      Promise.all(promises).then(() => {
        this.chatsSubject.next(chats);
      });
    });
  
    this.initialized = true;
  }

  // Get messages for a specific chat
  getChatMessages(chatId: string): Observable<Message[]> {
    const messagesRef = ref(this.db, `chats/${chatId}/messages`);
    const messagesQuery = query(messagesRef, orderByChild('timestamp'));

    return new Observable(subscriber => {
      onValue(messagesQuery, (snapshot) => {
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
      
      console.log(`Reset badge count for user ${userId} (${accountType})`);
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
