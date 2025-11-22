import { Component, OnInit, OnDestroy, effect, Signal, ViewChild, NgZone } from '@angular/core';
import { Keyboard } from '@capacitor/keyboard';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonAvatar, IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonItem, IonTextarea, IonTitle, IonToolbar, ModalController } from '@ionic/angular/standalone';
import { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
import { Subscription } from 'rxjs';
import { AccountService } from 'src/app/services/account/account.service';
import { UserService } from 'src/app/services/account/user.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { clientProfile } from 'src/app/Interfaces/Profiles/Client';
import { AgreementModalComponent } from 'src/app/components/agreements/agreement-modal/agreement-modal.component';
import { addIcons } from 'ionicons';
import { documentOutline, calendarOutline, document, documentText, documentTextOutline } from 'ionicons/icons';
import { Message } from 'src/app/Interfaces/Chats';
import { ChatsService } from 'src/app/services/chats.service';
import { AgreementMessageComponent } from 'src/app/components/agreements/agreement-message/agreement-message.component';
import { BookingMessageComponent } from 'src/app/components/booking-message/booking-message.component';
import { SessionRescheduleMessageComponent } from 'src/app/components/sessions/session-reschedule-message/session-reschedule-message.component';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { AutocorrectDirective } from 'src/app/directives/autocorrect.directive';
import { TwilioService } from 'src/app/services/twilio.service';
import { ToolTipComponent } from 'src/app/components/tool-tip/tool-tip.component';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
  standalone: true,
  imports: [
    IonAvatar,
    IonFooter,
    IonItem,
    IonHeader,
    IonIcon,
    IonButton,
    IonContent, 
    IonTitle, 
    IonBackButton,
    AgreementMessageComponent,
    BookingMessageComponent,
    SessionRescheduleMessageComponent,
    IonButtons,
    IonTextarea,
    IonToolbar, 
    CommonModule, 
    FormsModule,
    AutocorrectDirective,
    ToolTipComponent
  ]
})
export class ChatPage implements OnInit, OnDestroy {
  @ViewChild('content', { static: false }) private content!: IonContent;
  chatId: string | null = null;
  receiverId: string | null = null;
  accountType: "trainer" | "client" = "client"; // Set default and remove null
  receiverType: "trainer" | "client" = "trainer"; // Add new variable
  uid: string | null = null;
  receiverInfo: Signal<trainerProfile | clientProfile | null> | null = null;
  recieverName: string = '';
  recieverAvatar: string = '';
  messages: Message[] = [];
  newMessage: string = '';
  showTooltip: boolean = true;

  private messageSubscription?: Subscription;

  // Helper to check if this is a new chat from trainer contact
  get isNewChat(): boolean {
    return this.chatId === 'new';
  }

  // Get tooltip text
  get tooltipText(): string {
    return `Message ${this.recieverName} about what you're interested in to get started!`;
  }

  // Close tooltip
  closeTooltip() {
    this.showTooltip = false;
  }

  // Get the back button href based on context
  get backButtonHref(): string {
    return this.isNewChat ? `/tabs/trainers/trainer-info/${this.receiverId}` : '/tabs/chats';
  }

  constructor(
    private modalCtrl: ModalController,
    private route: ActivatedRoute,
    private router: Router,
    private chatsService: ChatsService,
    private accountService: AccountService,
    private userService: UserService,
    private zone: NgZone,
    private twilioService: TwilioService
  ) {
    // First effect for auth and initial setup
    effect(() => {
      if (this.accountService.isAuthReady()()) {
        const credentials = this.accountService.getCredentials()();
        const isAuthenticated = this.accountService.isLoggedIn()();
        
        if (isAuthenticated && credentials?.uid) {
          this.uid = credentials.uid;
          this.loadChatDetails();
        }
      }
    });

    // Separate effect for receiver info
    effect(() => {
      const userInfo = this.receiverInfo?.();
      console.log('User info:', userInfo);
      if (userInfo) {
        this.recieverName = userInfo.firstName + ' ' + userInfo.lastName;
        this.recieverAvatar = userInfo.profileImage || DEFAULT_ASSETS.PROFILE_PHOTO; 
      }
    });

    addIcons({
      documentOutline,
      calendarOutline
    });
  }

  ngOnInit() {
    this.receiverId = this.route.snapshot.paramMap.get('receiverId');
    this.chatId = this.route.snapshot.paramMap.get('chatId')!;
    this.accountType = this.route.snapshot.paramMap.get('accountType') === "trainer" ? "trainer" : "client";
    this.receiverType = this.accountType === "trainer" ? "client" : "trainer"; // Set opposite type
    
    if (this.receiverId && this.accountType) {
      this.receiverInfo = this.userService.getUserById(this.receiverId, this.receiverType); // Use receiverType here
    }
    
    // Set up keyboard event listeners
    this.setupKeyboardListeners();
  }
  
  // Set up keyboard event listeners for iOS
  private setupKeyboardListeners() {
    // Enable keyboard adjustment
    Keyboard.setAccessoryBarVisible({ isVisible: true });
    Keyboard.setScroll({ isDisabled: false });
    
    // Listen for keyboard show event
    Keyboard.addListener('keyboardWillShow', (info) => {
      this.zone.run(() => {
        // Scroll to bottom when keyboard shows
        setTimeout(() => {
          this.scrollToBottom();
        }, 100);
      });
    });
    
    // Listen for keyboard hide event
    Keyboard.addListener('keyboardWillHide', () => {
      this.zone.run(() => {
        // Adjust UI after keyboard hides if needed
        setTimeout(() => {
          this.scrollToBottom();
        }, 100);
      });
    });
  }
  
  // Keyboard listeners setup is handled here

  ionViewDidEnter() {
    this.scrollToBottom();
    
    // Reset badge count when the chat is opened
    if (this.uid) {
      this.chatsService.resetBadgeCount(this.uid);
    }
  }
  
  async scrollToBottom() {
    try {
      if (this.content) {
        // Force scroll to the absolute bottom with a slight delay to ensure DOM is updated
        setTimeout(() => {
          this.content.scrollToBottom(300).then(() => {
            // Double-check we're at the bottom by getting the scroll element and forcing it
            this.content.getScrollElement().then(scrollEl => {
              if (scrollEl) {
                scrollEl.scrollTop = scrollEl.scrollHeight;
              }
            });
          });
        }, 150);
      }
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  loadChatDetails() {
    // Only load chat details if we have an existing chat
    if (this.chatId && this.chatId !== 'new') {
      console.log('Loading chat details for chat ID:', this.chatId);
      this.messageSubscription = this.chatsService
        .getChatMessages(this.chatId)
        .subscribe(messages => {
          this.messages = messages;
          this.scrollToBottom();
          
          // Mark all messages as read when the chat is opened
          if (this.uid) {
            this.chatsService.markAllMessagesAsRead(this.chatId!, this.uid);
          }
        });
    }
  }

  async sendMessage() {
    if (this.newMessage.trim().length === 0 || !this.uid || !this.receiverId) return;

    // Store message locally before clearing the input
    const messageToSend = this.newMessage.trim();
    
    // Clear the input immediately for better UX
    this.newMessage = '';

    try {
      // Create new chat if chatId is 'new'
      if (this.chatId === 'new') {
        // Create chat and get new chatId
        this.chatId = await this.chatsService.createChat(this.uid, this.receiverId);
        // Initialize chat subscription after creating new chat
        this.loadChatDetails();
      }

      // Send message with the chatId (either existing or newly created)
      await this.chatsService.sendMessage(
        this.chatId!,
        this.uid,
        messageToSend
      );
      
    
      this.twilioService.sendTwilioMessage(
        this.chatId!,
        this.accountType,
        this.uid,
        this.receiverId,
        messageToSend
      );

      // Scroll to the absolute bottom after sending
      this.scrollToBottom();
    } catch (error) {
      console.error('Error sending message:', error);
      // If sending fails, restore the message to the input
      this.newMessage = messageToSend;
    }
  }

  isAgreementMessage(text: string): boolean {
    return text.startsWith('agreement/');
  }

  getAgreementId(text: string): string {
    return text.split('agreement/')[1];
  }

  isCalendarMessage(text: string): boolean {
    return text.startsWith('calendar/');
  }

  getTrainerId(text: string): string {
    return text.split('calendar/')[1];
  }
  
  isRescheduleMessage(text: string): boolean {
    return text.startsWith('reschedule/');
  }

  getRescheduleId(text: string): string {
    return text.split('reschedule/')[1];
  }

  async openAgreementModal() {
    const modal = await this.modalCtrl.create({
      component: AgreementModalComponent,
      componentProps: {
        clientId: this.receiverId  // Pass the clientId as a component property
      }
    });
  
    modal.present();
    const { data } = await modal.onWillDismiss();
    console.log('Modal data:', data);
    if (data?.action === 'send' && data?.id) {
      await this.chatsService.sendMessage(
        this.chatId!,
        this.uid!,
        `agreement/${data.id}`
      );
      
      if (this.chatId && this.uid && this.receiverId) {
        this.twilioService.sendTwilioMessage(
          this.chatId!,
          this.accountType,
          this.uid,
          this.receiverId,
          `agreement/${data.id}`
        );
      }
    }
  }

  /**
   * Share the trainer's availability calendar with the client
   */
  async shareCalendar() {
    if (!this.uid || !this.chatId || !this.receiverId) return;
    
    
    try {
      // Send a calendar message with the trainer's ID
      await this.chatsService.sendMessage(
        this.chatId,
        this.uid,
        `calendar/${this.uid}`
      );

          
      this.twilioService.sendTwilioMessage(
        this.chatId!,
        this.accountType,
        this.uid,
        this.receiverId,
        `calendar/${this.uid}`
      );
      
      
      console.log('Calendar shared with client');
    } catch (error) {
      console.error('Error sharing calendar:', error);
    }
  }

  goToNotes() {
    this.router.navigate([ROUTE_PATHS.APP.NOTES, this.receiverId]);
  }

  ngOnDestroy() {
    // Clean up keyboard listeners
    Keyboard.removeAllListeners();
    
    // Clean up message subscription
    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe();
    }
  }
}
