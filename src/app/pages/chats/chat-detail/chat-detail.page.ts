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
  AlertController,
  LoadingController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowUp, menuOutline } from 'ionicons/icons';
import { ChatsService } from 'src/app/services/chats.service';
import { UserService } from 'src/app/services/account/user.service';
import { AccountService } from 'src/app/services/account/account.service';
import { Chat, Message } from 'src/app/Interfaces/Chats';
import { ref, onValue, get } from '@angular/fire/database';
import { Database } from '@angular/fire/database';
import { Firestore, doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from '@angular/fire/firestore';
import { SessionRescheduleMessageComponent } from 'src/app/components/sessions/session-reschedule-message/session-reschedule-message.component';

interface WorkoutSummaryCardEntry {
  title: string;
  details: string[];
}

interface WorkoutSummaryCardSection {
  title: string;
  entries: WorkoutSummaryCardEntry[];
}

interface WorkoutSummaryCardModel {
  date: string;
  userName: string;
  estimatedCaloriesLine: string;
  sections: WorkoutSummaryCardSection[];
  trainerNotes: string;
}

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
    IonTextarea,
    SessionRescheduleMessageComponent
  ]
})
export class ChatDetailPage implements OnInit, OnDestroy {
  @ViewChild(IonContent) content!: IonContent;
  
  readonly atlasLogoPath = 'assets/icons/atlas.svg';
  chatId: string = '';
  otherUserId: string = '';
  otherUserName: string = 'User';
  otherUserProfilePic: string = '';
  isGroupChat = false;
  isPTGroupChat = false;
  groupId: string = '';
  groupMemberNames: string[] = [];
  currentUserId: string = '';
  messageText: string = '';
  messages: Message[] = [];
  
  private messagesUnsubscribe: (() => void) | null = null;
  private workoutSummaryCardCache = new Map<string, WorkoutSummaryCardModel>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private chatsService: ChatsService,
    private userService: UserService,
    private accountService: AccountService,
    private db: Database,
    private firestore: Firestore,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {
    addIcons({ arrowUp, menuOutline });
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
      await this.loadChatContext();
      this.loadMessages();
      if (!this.isGroupChat) {
        await this.loadOtherUserName();
      }
    }
  }

  private async loadChatContext(): Promise<void> {
    try {
      const chatRef = ref(this.db, `chats/${this.chatId}`);
      const snapshot = await get(chatRef);
      
      if (snapshot.exists()) {
        const chatData = snapshot.val() as Partial<Chat>;
        const participants = this.normalizeUserIds(chatData.participants);

        this.isGroupChat = this.isGroupChatRecord(chatData, participants);
        if (this.isGroupChat) {
          this.groupId = this.normalizeString(chatData.groupId);
          this.otherUserName = this.normalizeString(chatData.displayName) || 'Group Chat';
          this.otherUserProfilePic = this.normalizeString(chatData.groupImage);
          await this.loadGroupMemberNames(participants);
          return;
        }

        if (!this.otherUserId) {
          this.otherUserId = participants.find((id) => id !== this.currentUserId) || '';
        }
      }
    } catch (error) {
      console.error('Error loading chat context:', error);
    }
  }

  ngOnDestroy() {
    this.messagesUnsubscribe?.();
    this.messagesUnsubscribe = null;
    this.workoutSummaryCardCache.clear();
  }

  loadMessages() {
    const messagesRef = ref(this.db, `chats/${this.chatId}/messages`);

    this.messagesUnsubscribe?.();
    this.messagesUnsubscribe = onValue(messagesRef, (snapshot) => {
      this.messages = [];
      this.workoutSummaryCardCache.clear();
      
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
      let profile = await this.userService.getResolvedUserProfileDirectly(this.otherUserId, 'trainer');
      if (!profile) {
        profile = await this.userService.getResolvedUserProfileDirectly(this.otherUserId, 'client');
      }

      if (profile) {
        this.otherUserName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'User';
        this.otherUserProfilePic = String(profile.profilepic || '').trim();
      }
    } catch (error) {
      console.error('Error loading other user name:', error);
    }
  }

  async openGroupMembersMenu(): Promise<void> {
    if (!this.isGroupChat || this.groupMemberNames.length === 0) {
      return;
    }

    const membersHtml = this.groupMemberNames
      .map((memberName) => `- ${this.escapeHtml(memberName)}`)
      .join('<br/>');

    const alert = await this.alertCtrl.create({
      header: `${this.otherUserName} Members`,
      message: membersHtml,
      buttons: ['Close'],
    });

    await alert.present();
  }

  private async loadGroupMemberNames(fallbackParticipantIds: string[]): Promise<void> {
    let memberIds = fallbackParticipantIds;

    const normalizedGroupId = this.normalizeString(this.groupId);
    if (normalizedGroupId) {
      try {
        const groupRef = doc(this.firestore, 'groupID', normalizedGroupId);
        const groupSnapshot = await getDoc(groupRef);
        if (groupSnapshot.exists()) {
          const groupData = groupSnapshot.data() as Record<string, unknown>;
          this.isPTGroupChat = groupData['isPTGroup'] === true;

          const groupName = this.normalizeString(groupData['name']);
          if (groupName) {
            this.otherUserName = groupName;
          }

          const groupImage = this.normalizeString(groupData['groupImage']);
          if (groupImage) {
            this.otherUserProfilePic = groupImage;
          }

          memberIds = this.normalizeUserIds(groupData['userIDs']);
        }
      } catch (error) {
        console.error('Error loading group details for chat:', error);
      }
    }

    this.groupMemberNames = await this.resolveMemberNames(memberIds);
  }

  private async resolveMemberNames(memberIds: string[]): Promise<string[]> {
    const uniqueIds = this.normalizeUserIds(memberIds);
    if (uniqueIds.length === 0) {
      return [];
    }

    const memberNames = await Promise.all(
      uniqueIds.map(async (uid) => {
        try {
          const summary = await this.userService.getUserSummaryDirectly(uid);
          const username = this.normalizeString(summary?.username);
          const fullName = `${this.normalizeString(summary?.firstName)} ${this.normalizeString(summary?.lastName)}`.trim();

          if (uid === this.currentUserId) {
            if (username) {
              return `You (@${username})`;
            }
            if (fullName) {
              return `You (${fullName})`;
            }
            return 'You';
          }

          if (username) {
            return `@${username}`;
          }
          if (fullName) {
            return fullName;
          }
          return uid;
        } catch {
          return uid === this.currentUserId ? 'You' : uid;
        }
      })
    );

    return memberNames;
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

  isWorkoutSummaryMessage(message: Message): boolean {
    return message.type === 'workout_summary';
  }

  isAgreementEventMessage(message: Message): boolean {
    return message.type === 'agreement_event';
  }

  getWorkoutSummaryCard(message: Message): WorkoutSummaryCardModel {
    const cacheKey = `${message.messageId || message.timestamp || ''}:${message.text || ''}`;
    const cached = this.workoutSummaryCardCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const lines = String(message.text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const date = lines[0] ?? '';
    const userName = lines[1] ?? '';
    const estimatedCaloriesLine = lines[2] ?? '';
    const sections: WorkoutSummaryCardSection[] = [];
    let trainerNotes = '';
    let currentSection: WorkoutSummaryCardSection | null = null;
    let currentEntry: WorkoutSummaryCardEntry | null = null;

    for (const line of lines.slice(3)) {
      if (line === 'Strength:' || line === 'Cardio:' || line === 'Other:') {
        currentSection = {
          title: line.replace(':', ''),
          entries: [],
        };
        sections.push(currentSection);
        currentEntry = null;
        continue;
      }

      if (line === 'Notes for Trainer:') {
        currentSection = null;
        currentEntry = null;
        continue;
      }

      if (!currentSection) {
        trainerNotes = trainerNotes ? `${trainerNotes}\n${line}` : line;
        continue;
      }

      if (this.isWorkoutSummaryDetailLine(line)) {
        if (!currentEntry) {
          currentEntry = {
            title: 'Workout Entry',
            details: [],
          };
          currentSection.entries.push(currentEntry);
        }
        currentEntry.details.push(line);
        continue;
      }

      currentEntry = {
        title: line,
        details: [],
      };
      currentSection.entries.push(currentEntry);
    }

    const parsed = {
      date,
      userName,
      estimatedCaloriesLine,
      sections,
      trainerNotes,
    };
    this.workoutSummaryCardCache.set(cacheKey, parsed);
    return parsed;
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

  isRescheduleMessage(message: Message): boolean {
    return message.text?.startsWith('reschedule/') || false;
  }

  getRescheduleRequestId(message: Message): string {
    if (!this.isRescheduleMessage(message)) return '';
    return message.text.replace('reschedule/', '');
  }

  async openServiceAgreements(): Promise<void> {
    await this.router.navigate(['/service-agreements']);
  }

  private isWorkoutSummaryDetailLine(line: string): boolean {
    return [
      'Sets:',
      'Reps:',
      'Weights:',
      'Distance:',
      'Time:',
      'Calories Burned:',
      'Details:',
    ].some((prefix) => line.startsWith(prefix));
  }

  private isGroupChatRecord(chatData: Partial<Chat>, participants: string[]): boolean {
    return chatData.type === 'group' || !!this.normalizeString(chatData.groupId) || participants.length > 2;
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
