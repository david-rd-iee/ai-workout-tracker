import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, ViewChild, ElementRef, Signal, effect } from '@angular/core';
import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonAvatar, IonChip, IonLabel, IonItem, IonList, IonNote } from '@ionic/angular/standalone';
import Swiper from 'swiper';
import { Router } from '@angular/router';
import { chevronForwardOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { TruncatePipe } from 'src/app/pipes/truncate.pipe';
import { ChatsService } from 'src/app/services/chats.service';
import { AccountService } from 'src/app/services/account/account.service';
import { Observable, Subject, takeUntil, filter } from 'rxjs';
import { Chat } from 'src/app/Interfaces/Chats';
import { MessageDateTimePipe } from 'src/app/pipes/message-date-time.pipe';
import { HeaderComponent } from 'src/app/components/header/header.component';

@Component({
  selector: 'app-client-chat',
  templateUrl: './client-chats.page.html',
  styleUrls: ['./client-chats.page.scss', '../chat-shared.scss'],
  standalone: true,
  imports: [    
    IonContent,
    IonAvatar,
    IonLabel,
    IonNote,
    HeaderComponent,
    MessageDateTimePipe,
    IonItem, IonList, CommonModule, FormsModule]
})
export class ClientChatsPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  bearProfile = DEFAULT_ASSETS.PROFILE_PHOTO;
  @ViewChild('swiper') swiperRef: ElementRef | undefined;
  swiper?: Swiper;
  chats$ = this.chatService.chats$;



  constructor(
    private router: Router,
    private chatService: ChatsService,
    private accountService: AccountService
  ) {
    addIcons({
      chevronForwardOutline
    });

    // Create effect to watch auth state and initialize chats
    effect(() => {
      // Only proceed if auth is initialized
      if (this.accountService.isAuthReady()()) {
        const credentials = this.accountService.getCredentials()();
        const isAuthenticated = this.accountService.isLoggedIn()();
        
        if (isAuthenticated && credentials?.uid) {
          this.initializeChats(credentials.uid);
        }
      }
    });
  }

  ngOnInit() {
    // No longer need initialization here as it's handled by the effect
  }

  private initializeChats(userId: string) {
    this.chatService.initializeUserChats(userId, 'client');
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

}
