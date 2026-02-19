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
  IonTextarea,
  LoadingController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowUp } from 'ionicons/icons';
import { ChatsService } from 'src/app/services/chats.service';
import { UserService } from 'src/app/services/account/user.service';
import { AccountService } from 'src/app/services/account/account.service';
import { Message } from 'src/app/Interfaces/Chats';
import { ref, onValue, get } from '@angular/fire/database';
import { Database } from '@angular/fire/database';
import { Firestore, doc, updateDoc, arrayUnion, serverTimestamp } from '@angular/fire/firestore';

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
    private db: Database,
    private firestore: Firestore,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
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

  isGroupInvite(message: Message): boolean {
    return message.type === 'group_invite' && !!message.groupInvite;
  }

  canAcceptGroupInvite(message: Message): boolean {
    if (!this.isGroupInvite(message)) return false;
    if (this.isMyMessage(message)) return false;
    if (!message.groupInvite) return false;
    if (message.groupInvite.status !== 'pending') return false;
    return message.groupInvite.targetUserId === this.currentUserId;
  }

  async acceptGroupInvite(message: Message): Promise<void> {
    if (!this.chatId || !message.messageId || !this.canAcceptGroupInvite(message) || !message.groupInvite) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Joining group...',
    });
    await loading.present();

    try {
      const invite = message.groupInvite;
      const groupRef = doc(this.firestore, 'groupID', invite.groupId);
      await updateDoc(groupRef, {
        userIDs: arrayUnion(this.currentUserId),
        updatedAt: serverTimestamp(),
      });

      const userRef = doc(this.firestore, 'users', this.currentUserId);
      await updateDoc(userRef, {
        groupID: arrayUnion(invite.groupId),
      });

      await this.chatsService.markGroupInviteAccepted(this.chatId, message.messageId, this.currentUserId);
      await this.showToast(`Joined ${invite.groupName}.`);
    } catch (error) {
      console.error('Error accepting group invite:', error);
      await this.showToast('Could not join group. Please try again.');
    } finally {
      await loading.dismiss();
    }
  }

  isJoinRequest(message: Message): boolean {
    return message.type === 'join_request' && !!message.joinRequest;
  }

  canRespondJoinRequest(message: Message): boolean {
    if (!this.isJoinRequest(message) || !message.joinRequest) return false;
    if (message.joinRequest.status !== 'pending') return false;
    return message.joinRequest.targetOwnerId === this.currentUserId;
  }

  async acceptJoinRequest(message: Message): Promise<void> {
    await this.respondToJoinRequest(message, 'accepted');
  }

  async declineJoinRequest(message: Message): Promise<void> {
    await this.respondToJoinRequest(message, 'declined');
  }

  private async respondToJoinRequest(
    message: Message,
    status: 'accepted' | 'declined'
  ): Promise<void> {
    if (!this.chatId || !message.messageId || !message.joinRequest || !this.canRespondJoinRequest(message)) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: status === 'accepted' ? 'Accepting request...' : 'Declining request...',
    });
    await loading.present();

    try {
      const joinRequest = message.joinRequest;

      if (status === 'accepted') {
        const groupRef = doc(this.firestore, 'groupID', joinRequest.groupId);
        await updateDoc(groupRef, {
          userIDs: arrayUnion(joinRequest.requesterId),
          updatedAt: serverTimestamp(),
        });

        const userRef = doc(this.firestore, 'users', joinRequest.requesterId);
        await updateDoc(userRef, {
          groupID: arrayUnion(joinRequest.groupId),
        });
      }

      await this.chatsService.markJoinRequestStatus(
        this.chatId,
        message.messageId,
        status,
        this.currentUserId
      );

      await this.showToast(
        status === 'accepted'
          ? `Accepted request for ${joinRequest.groupName}.`
          : `Declined request for ${joinRequest.groupName}.`
      );
    } catch (error) {
      console.error('Error responding to join request:', error);
      await this.showToast('Could not update join request.');
    } finally {
      await loading.dismiss();
    }
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'bottom',
    });
    await toast.present();
  }
}
