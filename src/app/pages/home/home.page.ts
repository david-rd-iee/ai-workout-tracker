import { Component, ElementRef, OnInit, ViewChild, CUSTOM_ELEMENTS_SCHEMA, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonCardHeader, IonButton, IonIcon, IonCard, IonCardContent, IonCardTitle, IonItem, IonLabel, IonList, IonAvatar, IonBadge, IonSkeletonText } from '@ionic/angular/standalone';
// import { SwiperContainer } from 'swiper/element'; // Temporarily disabled
// import Swiper from 'swiper'; // Temporarily disabled
import { addIcons } from 'ionicons';
import { barbellOutline, cardOutline, cloudUploadOutline, calendarOutline, timeOutline, personOutline, cashOutline, analyticsOutline } from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import { Router } from '@angular/router';
import { ROUTE_PATHS } from '../../app.routes';
// import { SessionBookingService } from '../../services/session-booking.service'; // Service doesn't exist
import { UserService } from '../../services/account/user.service';
// import { TransactionService, Transaction } from '../../services/stripe/transaction.service'; // Service doesn't exist
type Transaction = any; // Temporary placeholder
type SessionData = any; // Temporary placeholder
import { NotificationService } from '../../services/notification.service';
import { PaymentReceivedItemComponent } from '../../components/payment-received-item/payment-received-item.component';
// import { ListSessionsComponent, SessionData } from '../../components/sessions/list-sessions/list-sessions.component'; // Temporarily disabled
//import { ListPaymentsComponent } from '../../components/list-payments/list-payments.component';
import { ChatsService } from '../../services/chats.service';
import { NavController } from '@ionic/angular';



@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    // ListSessionsComponent, // Temporarily disabled - not standalone
    //ListPaymentsComponent,
    // DatePipe, // Not used in template
    FormsModule,
    IonCard,
    IonCardContent,
    // IonCardTitle, // Not used in template
    // IonSkeletonText, // Not used in template
    // IonButton, // Not used in template
    // IonIcon, // Not used in template
    // PaymentReceivedItemComponent // Not used in template
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class HomePage implements OnInit {
  @ViewChild('swiper')
  swiperRef: ElementRef | undefined;
  swiper?: any; // Swiper type temporarily disabled
  segmentList: Array<string> = ['card1', 'card2'];
  selectedSegment: string = this.segmentList[0];
  
  // Upcoming sessions
  upcomingSessions: SessionData[] = [];
  isLoadingSessions = false;
  noSessionsFound = false;
  currentUser: any = null;
  userType: 'trainer' | 'client' = 'client'; // Default to client
  isUserLoaded = false; // Track if user data has been loaded
  
  // Test CORS variables
  corsTestResult: any = null;
  corsTestError: string | null = null;
  isTestingCors = false;
  
  // Recent payments (for trainers)
  recentPayments: Transaction[] = [];
  isLoadingPayments = false;
  noPaymentsFound = false;

  constructor(
    private router: Router,
    // private sessionBookingService: SessionBookingService, // Temporarily disabled
    private userService: UserService,
    // private transactionService: TransactionService, // Temporarily disabled
    private notificationService: NotificationService,
    private chatsService: ChatsService,
    private navCtrl: NavController
  ) { 
    addIcons({ 
      barbellOutline,
      cardOutline,
      cloudUploadOutline,
      calendarOutline,
      timeOutline,
      personOutline,
      cashOutline,
      analyticsOutline
    });
    
    // First effect to handle auth state changes
    effect(() => {
      const user = this.userService.getCurrentUser()();
      if (!user) {
        // User is not logged in, reset state
        this.currentUser = null;
        this.isUserLoaded = false;
        this.upcomingSessions = [];
        this.noSessionsFound = false;
      } else {
        // User is logged in, store auth data
        this.currentUser = user;
        // We'll load the profile in a separate effect
      }
    });
    
    // Second effect to handle profile data changes
    effect(() => {
      // Only proceed if we have auth data
      if (this.currentUser) {
        const profile = this.userService.getUserInfo()();
        
        if (profile) {
          // We have the user profile with account type
          this.userType = profile.accountType;
          this.isUserLoaded = true;
          
          // Initialize push notifications only after profile is complete
          this.notificationService.initPushNotifications();
          
          // If user is a client, check if they have any conversations
          if (this.userType === 'client') {
            this.checkClientConversations();
          }
          
          this.loadUpcomingSessions();
          
          // If user is a trainer, load recent payments
          if (this.userType === 'trainer') {
            this.loadRecentPayments();
          }
        } else {
          // No profile yet, try to load it
          this.userService.loadUserProfile().catch(err => {
            console.error('Error loading user profile:', err);
          });
        }
      }
    });
  }

  ngOnInit() {
    // No need to load sessions here, the effect() will handle it
    // when the user data is available
  }

  ionViewWillEnter() {
    // This will be called every time the view is about to enter
    // Perfect for refreshing data when navigating back to this page
    if (this.isUserLoaded && this.currentUser) {
      console.log('Home page: ionViewWillEnter - reloading upcoming sessions');
      this.loadUpcomingSessions();
      
      // If user is a trainer, reload recent payments
      if (this.userType === 'trainer') {
        this.loadRecentPayments();
      }
    }
  }

  swiperReady() {
    this.swiper = this.swiperRef?.nativeElement.swiper;
  }

  swiperSlideChanged(event: CustomEvent) {
    const swiper = this.swiperRef?.nativeElement.swiper;
    if (swiper) {
      const index = swiper.activeIndex;
      this.selectedSegment = this.segmentList[index];
    }
  }

  _segmentSelected(index: number) {
    this.swiper?.slideTo(index)
  }

  /**
   * Navigate to the payment page with a hardcoded agreement ID
   */
  goToPayment() {
    const agreementId = 'gA00Aa94pS0bIXe7lZpH';
    this.router.navigateByUrl(ROUTE_PATHS.PAYMENT.PROCESS(agreementId));
  }

  /**
   * Navigate to the calendar booking page for testing
   * Using a sample trainer ID for testing purposes
   */
  goToCalendar() {
    // Using a sample trainer ID for testing - replace with an actual trainer ID in your database
    const trainerId = 'CFMX8LN207VySCifrqBhWhT2fcm1';
    this.router.navigate(['/session-booking', trainerId]);
  }
  
  /**
   * Load upcoming sessions for the current week
   */
  async loadUpcomingSessions() {
    if (!this.currentUser || !this.isUserLoaded) {
      console.error('Cannot load sessions: No user logged in or user data not fully loaded');
      this.noSessionsFound = true;
      this.isLoadingSessions = false;
      return;
    }
    
    // Only start loading if we have a valid user with account type
    if (!this.userType) {
      console.error('Cannot load sessions: User account type not determined');
      this.noSessionsFound = true;
      this.isLoadingSessions = false;
      return;
    }
    
    this.isLoadingSessions = true;
    this.noSessionsFound = false;
    
    try {
      // Temporarily disabled - SessionBookingService not available
      // Get upcoming sessions for the current week
      // const userId = this.currentUser.uid;
      // const sessions = await this.sessionBookingService.getUpcomingWeekSessions(
      //   userId, 
      //   this.userType
      // );
      
      // Update the sessions array with raw data from the service
      this.upcomingSessions = []; // sessions;
      this.noSessionsFound = true; // sessions.length === 0;
      this.isLoadingSessions = false;
      
      console.log('Fetched upcoming sessions:', this.upcomingSessions);
    } catch (error) {
      console.error('Error loading upcoming sessions:', error);
      this.noSessionsFound = true;
      this.isLoadingSessions = false;
    }
  }
  

  


  /**
   * Load recent payment transactions for trainers
   */
  async loadRecentPayments() {
    if (!this.currentUser || this.userType !== 'trainer') {
      return;
    }

    try {
      this.isLoadingPayments = true;
      this.noPaymentsFound = false;
      
      // Get the trainer ID
      const trainerId = this.currentUser.uid;
      console.log('Loading recent payments for trainer:', trainerId);
      
      // Temporarily disabled - TransactionService not available
      // const transactions = await this.transactionService.getTrainerTransactions(trainerId, 5);
      
      this.recentPayments = []; // transactions;
      this.noPaymentsFound = true; // transactions.length === 0;
      console.log('Recent payments loaded:', this.recentPayments);
    } catch (error) {
      console.error('Error loading recent payments:', error);
      this.noPaymentsFound = true;
    } finally {
      this.isLoadingPayments = false;
    }
  }

  /**
   * Navigate to view all payment history
   */
  viewAllPayments() {
    // TODO: Implement navigation to full payment history page
    console.log('View all payments');
  }

  /**
   * Handle session change events (reschedule or cancel) from the list-sessions component
   * @param event The session change event containing action and sessionId
   */
  onSessionChanged(event: {action: string, sessionId: string}) {
    console.log('Session changed event received:', event);
    
    // Refresh the sessions list when a session is rescheduled or canceled
    if (event.action === 'reschedule' || event.action === 'cancel') {
      // Reload the upcoming sessions
      this.loadUpcomingSessions();
    }
  }

  /**
   * Check if a client has any conversations and redirect to trainer finder if not
   */
  async checkClientConversations() {
    if (!this.currentUser || this.userType !== 'client') {
      return;
    }

    try {
      const userId = this.currentUser.uid;
      const hasConversations = await this.chatsService.hasConversations(userId);
      
      if (!hasConversations) {
        console.log('Client has no conversations, redirecting to trainer finder');
        this.navCtrl.navigateRoot('/app/tabs/trainer-finder');
      }
    } catch (error) {
      console.error('Error checking client conversations:', error);
    }
  }
}
