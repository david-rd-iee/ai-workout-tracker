import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonAvatar, IonLabel, IonItem, IonList, IonNote } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { AccountService } from 'src/app/services/account/account.service';
import { ChatsService } from 'src/app/services/chats.service';
import { UserService } from 'src/app/services/account/user.service';
import { Observable } from 'rxjs';
import { Chat } from 'src/app/Interfaces/Chats';

@Component({
  selector: 'app-client-chat',
  template: `
    <div class="chats-shell">
      <ion-list class="chats-list" lines="none">
        <ion-item 
          class="chat-item"
          *ngFor="let chat of chats$ | async" 
          button 
          (click)="loadChat(chat)"
          detail="true"
        >
          <ion-avatar slot="start">
            <img [src]="getChatAvatar(chat)" alt="Profile" />
          </ion-avatar>
          <ion-label>
            <h2>{{ getChatTitle(chat) }}</h2>
            <ion-note>{{ chat.lastMessage || 'No messages yet' }}</ion-note>
          </ion-label>
          <ion-note slot="end" *ngIf="chat.hasUnreadMessages" color="primary">
            <strong>New</strong>
          </ion-note>
        </ion-item>
      </ion-list>

      <div class="empty-state" *ngIf="(chats$ | async)?.length === 0">
        <p>No chats yet</p>
        <span>Your messages with trainers and clients will show up here.</span>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .chats-shell {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .chats-list {
      background: transparent;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 0;
      margin: 0;
    }

    .chat-item {
      --background: transparent;
      --border-color: transparent;
      --inner-border-width: 0;
      --padding-start: 18px;
      --padding-end: 18px;
      --inner-padding-end: 0;
      --min-height: 84px;
      --detail-icon-color: #172bff;
      --detail-icon-opacity: 1;
      background: linear-gradient(145deg, #f5f9ff, #eef4fe);
      border-radius: 24px;
      box-shadow:
        7px 7px 14px rgba(204, 213, 226, 0.9),
        -7px -7px 14px rgba(255, 255, 255, 0.95);
      margin: 0;
      overflow: hidden;
    }

    .chat-item::part(native) {
      background: transparent;
      border-radius: 24px;
    }

    .chat-item ion-avatar {
      width: 54px;
      height: 54px;
      padding: 4px;
      background: linear-gradient(145deg, #f8fbff, #edf3fd);
      box-shadow:
        inset 1px 1px 2px rgba(255, 255, 255, 0.95),
        inset -1px -1px 2px rgba(204, 213, 226, 0.6),
        5px 5px 10px rgba(204, 213, 226, 0.55);
    }

    .chat-item ion-label h2 {
      margin: 0 0 6px;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 700;
      color: #111111;
      font-family: 'Roboto Flex', 'Inter', sans-serif;
    }

    .chat-item ion-label ion-note {
      display: block;
      color: #5b6473;
      font-size: 14px;
      line-height: 1.35;
    }

    .chat-item > ion-note[slot="end"] {
      margin-left: 12px;
      padding: 8px 12px;
      border-radius: 999px;
      background: linear-gradient(145deg, #3254ff, #172bff);
      color: #ffffff !important;
      font-size: 12px;
      font-weight: 700;
      box-shadow:
        6px 6px 12px rgba(23, 43, 255, 0.18),
        -3px -3px 8px rgba(255, 255, 255, 0.72);
    }

    .empty-state {
      padding: 28px 24px;
      text-align: center;
      background: linear-gradient(145deg, #f5f9ff, #eef4fe);
      border-radius: 24px;
      box-shadow:
        7px 7px 14px rgba(204, 213, 226, 0.9),
        -7px -7px 14px rgba(255, 255, 255, 0.95);
    }

    .empty-state p {
      margin: 0 0 6px;
      font-size: 18px;
      font-weight: 700;
      color: #111111;
    }

    .empty-state span {
      color: #5b6473;
      font-size: 14px;
      line-height: 1.45;
    }
  `],
  standalone: true,
  imports: [    
    IonAvatar,
    IonLabel,
    IonNote,
    IonItem,
    IonList,
    CommonModule,
    FormsModule
  ]
})
export class ClientChatsPage implements OnInit {
  private router = inject(Router);
  private accountService = inject(AccountService);
  private chatsService = inject(ChatsService);
  private userService = inject(UserService);
  
  chats$: Observable<Chat[]> = this.chatsService.chats$;



  constructor() {}

  ngOnInit() {
    void this.initializeChatsForCurrentUser();
  }

  ionViewWillEnter(): void {
    void this.initializeChatsForCurrentUser();
  }

  ionViewDidLeave(): void {
    this.chatsService.resetInitialization();
  }

  private async initializeChatsForCurrentUser(): Promise<void> {
    const credentials = this.accountService.getCredentials()();
    if (!credentials?.uid) {
      return;
    }

    let userProfile = this.userService.getUserInfo()();
    if (!userProfile?.accountType) {
      await this.userService.loadUserProfile();
      userProfile = this.userService.getUserInfo()();
    }

    if (!userProfile?.accountType) {
      return;
    }

    this.initializeChats(credentials.uid, userProfile.accountType as 'trainer' | 'client');
  }

  private initializeChats(userId: string, userType: 'trainer' | 'client'): void {
    this.chatsService.initializeUserChats(userId, userType);
    this.chats$ = this.chatsService.chats$;
  }

  getChatTitle(chat: Chat): string {
    if (this.isGroupChat(chat)) {
      return chat.displayName || 'Group Chat';
    }

    if (chat.displayName?.trim()) {
      return chat.displayName.trim();
    }

    const profile = chat.userProfile?.();
    if (!profile) {
      return 'User';
    }

    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    return fullName || 'User';
  }

  getChatAvatar(chat: Chat): string {
    if (this.isGroupChat(chat)) {
      return chat.groupImage || 'assets/icons/Icon.png';
    }

    return chat.profilepic || chat.userProfile?.()?.profilepic || 'assets/icon/favicon.png';
  }

  loadChat(chat: Chat) {
    const currentUserId = this.accountService.getCredentials()().uid;
    const userProfile = this.userService.getUserInfo()();
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    const otherUserId = participants.find((participant) => participant !== currentUserId);
    const isGroupChat = this.isGroupChat(chat);

    if (!userProfile?.accountType) {
      return;
    }

    if (isGroupChat || otherUserId) {
      this.router.navigate(['/chat', chat.chatId], {
        state: {
          ...(otherUserId ? { otherUserId } : {}),
          userType: userProfile.accountType,
          ...(isGroupChat ? { isGroupChat: true, groupId: chat.groupId || '' } : {}),
        }
      });
    }
  }

  navigateToWorkoutSummary() {
    this.router.navigate(['/workout-summary']);
  }

  private isGroupChat(chat: Chat): boolean {
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    return chat.type === 'group' || !!chat.groupId || participants.length > 2;
  }

}
