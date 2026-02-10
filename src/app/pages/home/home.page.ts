// src/app/pages/home/home.page.ts
import { Component, OnInit, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { UserService } from 'src/app/services/account/user.service';
import { IonContent, IonCard, IonCardContent, IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { AccountService } from 'src/app/services/account/account.service';
import { 
  personCircleOutline, 
  trophyOutline, 
  fitnessOutline, 
  peopleOutline, 
  chatbubblesOutline,
  addCircle,
  flame,
  calendarOutline,
  chevronForward,
  personOutline,
  cashOutline,
  chevronBack
} from 'ionicons/icons';

interface Widget {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
}

interface HomePageConfig {
  clientId: string;
  widgets: Widget[];
  customMessage?: string;
}

interface Exercise {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weightUnit?: string;
  duration?: number;
}

interface NextWorkout {
  title: string;
  date: Date;
  type?: string;
  duration?: number;
  exercises?: Exercise[];
  notes?: string;
}

interface UpcomingSession {
  id: string;
  trainerName: string;
  date: Date;
  notes?: string;
  duration?: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonContent, IonCard, IonCardContent, IonIcon, IonButton, HeaderComponent],
})
export class HomePage implements OnInit {
  currentDate = new Date();
  userName = computed(() => {
    const userProfile = this.userService.getUserInfo()();
    return userProfile?.firstName || 'User';
  });
  accountType = computed(() => {
    const userProfile = this.userService.getUserInfo()();
    return userProfile?.accountType || 'client';
  });
  currentStreak = 0;
  nextWorkout: NextWorkout | null = null;
  upcomingSessions: UpcomingSession[] = [];
  
  // Home page customization
  homeConfig: HomePageConfig | null = null;
  customMessage: string = '';
  
  // Trainer-specific data
  clients: any[] = [];
  currentMonthIndex = 0;
  monthlyRevenue: any[] = [];
  totalRevenue = 0;

  constructor(
    private router: Router,
    private userService: UserService,
    private firestore: Firestore,
    private accountService: AccountService
  ) {
    addIcons({ 
      personCircleOutline, 
      trophyOutline, 
      fitnessOutline, 
      peopleOutline, 
      chatbubblesOutline,
      addCircle,
      flame,
      calendarOutline,
      chevronForward,
      personOutline,
      cashOutline,
      chevronBack
    });
    
    // Watch for profile changes and load appropriate data
    effect(() => {
      const userProfile = this.userService.getUserInfo()();
      if (userProfile) {
        console.log('User profile loaded, accountType:', userProfile.accountType);
        if (userProfile.accountType === 'trainer') {
          this.loadTrainerClients();
        } else {
          this.loadClientData();
        }
      }
    });
  }

  ngOnInit() {
    // Initial data load will be handled by the effect
  }

  async loadTrainerClients() {
    console.log('Loading trainer clients...');
    
    const credentials = this.accountService.getCredentials()();
    if (!credentials?.uid) {
      console.error('No credentials available');
      return;
    }

    const trainerId = credentials.uid;
    
    // Generate revenue data for last 3 months and next 2 months
    const today = new Date();
    this.monthlyRevenue = [];
    this.totalRevenue = 0;
    
    for (let i = -3; i <= 2; i++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const revenue = i <= 0 ? Math.floor(Math.random() * 2000) + 3000 : 0; // Past/current months have revenue
      
      this.monthlyRevenue.push({
        month: monthDate,
        revenue: revenue,
        sessions: i <= 0 ? Math.floor(revenue / 75) : 0,
        isPast: i < 0,
        isCurrent: i === 0,
        isFuture: i > 0
      });
      
      if (i <= 0) {
        this.totalRevenue += revenue;
      }
    }
    
    this.currentMonthIndex = 3; // Current month is at index 3
    
    // Load real clients from Firestore
    try {
      const trainerClientsRef = doc(this.firestore, 'trainerClients', trainerId);
      const trainerClientsSnap = await getDoc(trainerClientsRef);
      
      if (trainerClientsSnap.exists()) {
        const data = trainerClientsSnap.data();
        this.clients = (data['clients'] || []).map((client: any) => ({
          id: client.clientId,
          name: client.clientName || 'Unknown Client',
          profileImage: client.profileImage || '',
          nextSession: client.nextSession ? new Date(client.nextSession) : new Date(Date.now() + 86400000),
          totalSessions: client.totalSessions || 0,
          lastWorkout: client.lastSession ? new Date(client.lastSession) : new Date(Date.now() - 172800000)
        }));
        console.log('Loaded', this.clients.length, 'real clients from Firestore');
      } else {
        console.log('No clients found for this trainer');
        this.clients = [];
      }
    } catch (error) {
      console.error('Error loading trainer clients:', error);
      this.clients = [];
    }
  }

  loadUserData() {
    // Deprecated - keeping for backwards compatibility
    this.loadClientData();
  }
  
  isWidgetEnabled(widgetId: string): boolean {
    if (!this.homeConfig) {
      // If no config, show default widgets
      const defaultWidgets = ['welcome', 'streak', 'next-workout', 'upcoming-session'];
      return defaultWidgets.includes(widgetId);
    }
    const widget = this.homeConfig.widgets.find(w => w.id === widgetId);
    return widget ? widget.enabled : false;
  }
  
  getWidgetOrder(widgetId: string): number {
    if (!this.homeConfig) return 999;
    const widget = this.homeConfig.widgets.find(w => w.id === widgetId);
    return widget ? widget.order : 999;
  }
  
  async loadClientData() {
    // Load home page customization from Firestore
    const credentials = this.accountService.getCredentials()();
    if (credentials?.uid) {
      try {
        const configRef = doc(this.firestore, `clientHomeConfigs/${credentials.uid}`);
        const configSnap = await getDoc(configRef);
        
        if (configSnap.exists()) {
          this.homeConfig = configSnap.data() as HomePageConfig;
          this.customMessage = this.homeConfig.customMessage || '';
          console.log('Loaded home page configuration:', this.homeConfig);
        } else {
          console.log('No home page customization found, using defaults');
        }
      } catch (error) {
        console.error('Error loading home page config:', error);
      }
    }
    
    // TODO: Load actual streak data from service
    this.currentStreak = 5; // Placeholder
    
    // Fake workout for demonstration
    this.nextWorkout = {
      title: 'Upper Body Strength',
      date: new Date(Date.now() + 86400000), // Tomorrow
      type: 'Strength Training',
      duration: 60,
      exercises: [
        { name: 'Bench Press', sets: 4, reps: 8, weight: 135, weightUnit: 'lbs' },
        { name: 'Pull-ups', sets: 3, reps: 10 },
        { name: 'Shoulder Press', sets: 3, reps: 12, weight: 45, weightUnit: 'lbs' },
        { name: 'Bicep Curls', sets: 3, reps: 15, weight: 25, weightUnit: 'lbs' },
        { name: 'Tricep Dips', sets: 3, reps: 12 }
      ],
      notes: 'Focus on jerking it harder. No rest between sets.'
    };

    // TODO: Load upcoming sessions from booking service
    // Placeholder data for demonstration
    this.upcomingSessions = [
      {
        id: '1',
        trainerName: 'John Smith',
        date: new Date(Date.now() + 172800000), // 2 days from now
        notes: 'Focus on jerking it harder. No rest between sets.',
        duration: 60
      },
      {
        id: '2',
        trainerName: 'Sarah Johnson',
        date: new Date(Date.now() + 432000000), // 5 days from now
        notes: '😳',
        duration: 45
      }
    ];
  }

  startWorkout() {
    // Navigate to workout chatbot to start logging
    this.router.navigate(['/tabs/chats/workout-chatbot']);
  }

  viewStreak() {
    // TODO: Navigate to streak page (to be created)
    // For now, navigate to profile which might show stats
    this.router.navigate(['/tabs/profile']);
  }

  viewNextWorkout() {
    if (this.nextWorkout) {
      // Navigate to workout details page with workout data
      this.router.navigate(['/workout-details'], { 
        state: { workout: this.nextWorkout } 
      });
    } else {
      // Navigate to calendar to schedule a workout
      this.router.navigate(['/tabs/calender']);
    }
  }

  viewSessionDetails(session: UpcomingSession) {
    // Navigate to calendar to view session details
    this.router.navigate(['/tabs/calender']);
  }
  
  viewClientDetails(client: any) {
    // Navigate to client details page
    this.router.navigate(['/client-details'], { 
      state: { client } 
    });
  }
  
  previousMonth() {
    if (this.currentMonthIndex > 0) {
      this.currentMonthIndex--;
    }
  }
  
  nextMonth() {
    if (this.currentMonthIndex < this.monthlyRevenue.length - 1) {
      this.currentMonthIndex++;
    }
  }
  
  get currentMonthData() {
    return this.monthlyRevenue[this.currentMonthIndex];
  }
  
  navigateTo(path: string): void {
    this.router?.navigate([path]);
  }
}
