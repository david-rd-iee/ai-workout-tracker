import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { 
  IonContent, 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonButton, 
  IonButtons,
  IonBackButton,
  IonIcon,
  IonFooter,
  IonTextarea
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowUp } from 'ionicons/icons';
import { ChatsService } from 'src/app/services/chats.service';
import { UserService } from 'src/app/services/account/user.service';
import { AccountService } from 'src/app/services/account/account.service';
import { Message } from 'src/app/Interfaces/Chats';
import { ref, onValue, get } from '@angular/fire/database';
import { Database } from '@angular/fire/database';

@Component({
  selector: 'app-chat-detail',
  standalone: true,
  templateUrl: './chat-detail.page.html',
  styleUrls: ['./chat-detail.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButton,
    IonButtons,
    IonBackButton,
    IonIcon,
    IonFooter,
    IonTextarea
  ]
})
export class ChatDetailPage implements OnInit, OnDestroy {
  @ViewChild(IonContent) content!: IonContent;
  
  chatId: string = '';
  otherUserId: string = '';
  otherUserName: string = 'User';
  currentUserId: string = '';
  messageText: string = '';
  messages: Message[] = [];
  
  private messagesUnsubscribe: (() => void) | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private chatsService: ChatsService,
    private userService: UserService,
    private accountService: AccountService,
    private db: Database
  ) {
    addIcons({ arrowUp });
  }

  async ngOnInit() {
    // Get chatId from route params
    this.chatId = this.route.snapshot.paramMap.get('chatId') || '';
    
    // Get current user ID
    const credentials = this.accountService.getCredentials()();
    this.currentUserId = credentials?.uid || '';
    
    // Get other user ID from navigation state or route
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras?.state) {
      this.otherUserId = navigation.extras.state['otherUserId'];
    }
    
    if (this.chatId) {
      // If we don't have otherUserId, get it from the chat data
      if (!this.otherUserId) {
        await this.loadOtherUserIdFromChat();
      }
      
      this.loadMessages();
      this.loadOtherUserName();
    }
  }

  async loadOtherUserIdFromChat() {
    try {
      const chatRef = ref(this.db, `chats/${this.chatId}`);
      const snapshot = await get(chatRef);
      
      if (snapshot.exists()) {
        const chatData = snapshot.val();
        const participants = chatData.participants || [];
        
        // Find the other user (not current user)
        this.otherUserId = participants.find((id: string) => id !== this.currentUserId) || '';
      }
    } catch (error) {
      console.error('Error loading other user ID from chat:', error);
    }
  }

  ngOnDestroy() {
    this.messagesUnsubscribe?.();
    this.messagesUnsubscribe = null;
  }

  loadMessages() {
    const messagesRef = ref(this.db, `chats/${this.chatId}/messages`);

    this.messagesUnsubscribe?.();
    this.messagesUnsubscribe = onValue(messagesRef, (snapshot) => {
      this.messages = [];
      
      snapshot.forEach((childSnapshot) => {
        const message = childSnapshot.val() as Message;
        message.messageId = childSnapshot.key || '';
        this.messages.push(message);
      });
      
      // Sort messages by timestamp
      this.messages.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      // Scroll to bottom after messages load
      setTimeout(() => {
        this.scrollToBottom();
      }, 100);
      
      // Mark messages as read
      this.markMessagesAsRead();
    });
  }

  async loadOtherUserName() {
    if (!this.otherUserId) {
      return;
    }
    
    try {
      // Try loading as trainer first
      let profile = await this.userService.getUserProfileDirectly(this.otherUserId, 'trainer');
      
      if (!profile) {
        // If not a trainer, try as client
        profile = await this.userService.getUserProfileDirectly(this.otherUserId, 'client');
      }
      
      if (profile) {
        this.otherUserName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'User';
      }
    } catch (error) {
      console.error('Error loading other user name:', error);
    }
  }

  async sendMessage() {
    if (!this.messageText.trim()) {
      return;
    }

    try {
      await this.chatsService.sendMessage(this.chatId, this.currentUserId, this.messageText.trim());
      this.messageText = '';
      
      // Scroll to bottom after sending
      setTimeout(() => {
        this.scrollToBottom();
      }, 100);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  private scrollToBottom() {
    if (this.content) {
      this.content.scrollToBottom(300);
    }
  }

  private markMessagesAsRead(): void {
    if (!this.chatId || !this.currentUserId) {
      return;
    }
    void this.chatsService.markAllMessagesAsRead(this.chatId, this.currentUserId);
  }

  isMyMessage(message: Message): boolean {
    return message.senderId === this.currentUserId;
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }
}
