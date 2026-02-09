import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, ViewChild, ElementRef, Signal, inject } from '@angular/core';
// import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
const DEFAULT_ASSETS = { PROFILE_PHOTO: '' };
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonAvatar, IonChip, IonLabel, IonItem, IonList, IonNote, IonButton, IonIcon } from '@ionic/angular/standalone';
// import Swiper from 'swiper';
import { Router } from '@angular/router';
import { chevronForwardOutline, fitnessOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';
// import { TruncatePipe } from 'src/app/pipes/truncate.pipe';
import { AccountService } from 'src/app/services/account/account.service';
import { Observable, Subject, takeUntil, filter, of } from 'rxjs';
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
          <img [src]="bearProfile || 'assets/icon/favicon.png'" alt="Profile" />
        </ion-avatar>
        <ion-label>
          <h2>Chat</h2>
          <ion-note>{{ chat.lastMessage || 'No messages yet' }}</ion-note>
        </ion-label>
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
    IonButton,
    IonIcon,
    // MessageDateTimePipe,
    IonItem, IonList, CommonModule, FormsModule]
})
export class ClientChatsPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  bearProfile = DEFAULT_ASSETS.PROFILE_PHOTO;
  @ViewChild('swiper') swiperRef: ElementRef | undefined;
  swiper?: any; // Swiper;
  
  private router = inject(Router);
  private accountService = inject(AccountService);
  
  // Temporary: Use empty observable to avoid circular dependency
  // TODO: Fix circular dependency with ChatsService
  chats$: Observable<Chat[]> = of([]);



  constructor() {
    addIcons({
      chevronForwardOutline,
      fitnessOutline
    });
  }

  ngOnInit() {
    // Temporarily disabled to avoid circular dependency
    // const credentials = this.accountService.getCredentials()();
    // if (credentials?.uid) {
    //   this.initializeChats(credentials.uid);
    // }
  }

  private initializeChats(userId: string) {
    // this.chatService.initializeUserChats(userId, 'client');
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  swiperReady() {
    this.swiper = this.swiperRef?.nativeElement.swiper;
  }

  loadChat(chatId: string, participants: string[]) {
    const currentUserId = this.accountService.getCredentials()().uid;
    const client = participants.find(participant => participant !== currentUserId);
    if (client) {
      this.router.navigate(['/chat', chatId,client, "client"]);
    }
  }

  navigateToWorkoutSummary() {
    this.router.navigate(['/workout-summary']);
  }

}
