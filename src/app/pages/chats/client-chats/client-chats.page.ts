import { Component, OnInit, ViewChild, ElementRef, inject } from '@angular/core';
// import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
const DEFAULT_ASSETS = { PROFILE_PHOTO: '' };
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonAvatar, IonLabel, IonItem, IonList, IonNote } from '@ionic/angular/standalone';
// import Swiper from 'swiper';
import { Router } from '@angular/router';
// import { TruncatePipe } from 'src/app/pipes/truncate.pipe';
import { AccountService } from 'src/app/services/account/account.service';
import { ChatsService } from 'src/app/services/chats.service';
import { UserService } from 'src/app/services/account/user.service';
import { Observable } from 'rxjs';
import { Chat } from 'src/app/Interfaces/Chats';
// import { MessageDateTimePipe } from 'src/app/pipes/message-date-time.pipe';

@Component({
  selector: 'app-client-chat',
  template: `
    <ion-list>
      <ion-item 
        *ngFor="let chat of chats$ | async" 
        button 
        (click)="loadChat(chat.chatId, chat.participants)"
        detail="true"
      >
        <ion-avatar slot="start">
          <img [src]="chat.userProfile?.()?.profilepic || 'assets/icon/favicon.png'" alt="Profile" />
        </ion-avatar>
        <ion-label>
          <h2>{{ chat.userProfile?.()?.firstName || 'Loading...' }} {{ chat.userProfile?.()?.lastName || '' }}</h2>
          <ion-note>{{ chat.lastMessage || 'No messages yet' }}</ion-note>
        </ion-label>
        <ion-note slot="end" *ngIf="chat.hasUnreadMessages" color="primary">
          <strong>New</strong>
        </ion-note>
      </ion-item>
    </ion-list>

    <div *ngIf="(chats$ | async)?.length === 0" style="text-align: center; padding: 40px;">
      <p>No chats yet</p>
    </div>
  `,
  styles: [`
  `],
  standalone: true,
  imports: [    
    IonAvatar,
    IonLabel,
    IonNote,
    // MessageDateTimePipe,
    IonItem, IonList, CommonModule, FormsModule]
})
export class ClientChatsPage implements OnInit {
  bearProfile = DEFAULT_ASSETS.PROFILE_PHOTO;
  @ViewChild('swiper') swiperRef: ElementRef | undefined;
  swiper?: any; // Swiper;
  
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

  swiperReady() {
    this.swiper = this.swiperRef?.nativeElement.swiper;
  }

  loadChat(chatId: string, participants: string[]) {
    const currentUserId = this.accountService.getCredentials()().uid;
    const userProfile = this.userService.getUserInfo()();
    const otherUserId = participants.find(participant => participant !== currentUserId);
    
    if (otherUserId && userProfile?.accountType) {
      // Navigate to standalone chat detail page (outside tabs)
      this.router.navigate(['/chat', chatId], {
        state: { 
          otherUserId,
          userType: userProfile.accountType
        }
      });
    }
  }

  navigateToWorkoutSummary() {
    this.router.navigate(['/workout-summary']);
  }

}
