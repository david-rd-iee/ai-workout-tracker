import { Component, OnDestroy, OnInit, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
} from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import {
  personCircle,
  chatbubblesOutline,
  fitnessOutline,
  peopleOutline,
  personCircleOutline,
  personOutline,
  trophyOutline,
  constructOutline,
  addCircle,
  flame,
  calendarOutline,
  chevronForward,
  cashOutline,
  chevronBack
} from 'ionicons/icons';

import { Auth } from '@angular/fire/auth';
import { Firestore, doc, docData, getDoc, setDoc, serverTimestamp, onSnapshot, collection, query, where, getDocs, Timestamp } from '@angular/fire/firestore';
import { authState } from 'rxfire/auth';
import { switchMap, of } from 'rxjs';
import { Subscription } from 'rxjs';
import { HeaderComponent } from 'src/app/components/header/header.component';

import type { AppUser } from '../../models/user.model';

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
  type: string;
  duration: number;
  exercises: Exercise[];
  notes?: string;
}

interface UpcomingSession {
  id: string;
  trainerName: string;
  date: Date;
  notes?: string;
  duration: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonIcon,
    HeaderComponent,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  private userSub?: Subscription;

  isLoadingUser = true;
  currentUser: AppUser | null = null;
  
  // Trainer-specific data
  clients: any[] = [];
  currentMonthIndex = 0;
  monthlyRevenue: any[] = [];
  totalRevenue = 0;
  
  // Client-specific data
  currentStreak = 0;
  nextWorkout: NextWorkout | null = null;
  upcomingSessions: UpcomingSession[] = [];
  homeConfig: HomePageConfig | null = null;
  customMessage: string = '';
  
  // Display properties
  currentDate = new Date();

  // Helper method to get user's first name for greeting
  userName(): string {
    return this.currentUser?.firstName || 'User';
  }

  constructor() {
    addIcons({
      constructOutline,
      personCircleOutline,
      personOutline,
      trophyOutline,
      fitnessOutline,
      peopleOutline,
      chatbubblesOutline,
      addCircle,
      flame,
      calendarOutline,
      chevronForward,
      cashOutline,
      chevronBack
    });
  }

  ngOnInit(): void {
    this.userSub?.unsubscribe();

    this.userSub = authState(this.auth).pipe(
      switchMap((fbUser) => {
        if (!fbUser) {
          this.currentUser = null;
          this.isLoadingUser = false;
          return of(null);
        }

        // Try trainers collection first, then clients
        const trainerRef = doc(this.firestore, 'trainers', fbUser.uid);
        return docData(trainerRef, { idField: 'userId' }).pipe(
          switchMap((trainer) => {
            if (trainer) {
              return of({ ...trainer, isPT: true });
            }
            // If not a trainer, check clients collection
            const clientRef = doc(this.firestore, 'clients', fbUser.uid);
            return docData(clientRef, { idField: 'userId' }).pipe(
              switchMap((client) => {
                if (client) {
                  return of({ ...client, isPT: false });
                }
                return of(null);
              })
            );
          })
        );
      })
    ).subscribe({
      next: (u) => {
        // Map profileImage to profilepic for backward compatibility
        if (u && (u as any).profileImage && !(u as any).profilepic) {
          (u as any).profilepic = (u as any).profileImage;
        }
        this.currentUser = (u as any) ?? null;
        this.isLoadingUser = false;
        
        console.log('Current user loaded:', this.currentUser);

        // Home pulls from trainers/clients, but profile image is often stored in users/{uid}.
        if (this.currentUser?.userId) {
          void this.hydrateHeaderProfileFields(this.currentUser.userId);
        }
        
        // Load appropriate data based on account type
        if (this.currentUser) {
          if (this.currentUser.isPT === true) {
            this.loadTrainerClients();
          } else {
            this.loadClientData();
          }
        }
      },
      error: (err) => {
        console.error(err);
        this.currentUser = null;
        this.isLoadingUser = false;
      },
    });
  }

  private async hydrateHeaderProfileFields(uid: string): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) return;
      if (!this.currentUser || this.currentUser.userId !== uid) return;

      const userData = userSnap.data() as any;
      const usersProfilepic = typeof userData?.profilepic === 'string' ? userData.profilepic.trim() : '';
      const usersProfileImage = typeof userData?.profileImage === 'string' ? userData.profileImage.trim() : '';
      const usersUsername = typeof userData?.username === 'string' ? userData.username.trim() : '';

      this.currentUser = {
        ...this.currentUser,
        profilepic: usersProfilepic || this.currentUser.profilepic,
        profileImage: usersProfileImage || this.currentUser.profileImage,
        username: usersUsername || this.currentUser.username,
      };
    } catch (error) {
      console.error('Error hydrating header profile fields:', error);
    }
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  async loadTrainerClients() {
    console.log('Loading trainer clients...');
    
    const trainerId = this.auth.currentUser?.uid;
    if (!trainerId) {
      console.error('No authenticated user');
      return;
    }

    // Calculate revenue from actual bookings
    await this.calculateRevenueFromBookings(trainerId);
    
    // Set up real-time listener for clients (updates automatically!)
    try {
      const trainerClientsRef = doc(this.firestore, 'trainerClients', trainerId);
      
      // Use onSnapshot for real-time updates
      onSnapshot(trainerClientsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          this.clients = (data['clients'] || []).map((client: any) => {
            // Support both new (firstName/lastName) and old (clientName) formats
            let displayName = '';
            if (client.firstName || client.lastName) {
              displayName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
            } else if (client.clientName) {
              displayName = client.clientName;
            }
            displayName = displayName || 'Unknown Client';
            
            return {
              id: client.clientId,
              firstName: client.firstName || '',
              lastName: client.lastName || '',
              name: displayName,
              profileImage: client.profileImage || '',
              nextSession: client.nextSession ? new Date(client.nextSession) : new Date(Date.now() + 86400000),
              totalSessions: client.totalSessions || 0,
              lastWorkout: client.lastSession ? new Date(client.lastSession) : new Date(Date.now() - 172800000)
            };
          });
          console.log('📊 Real-time update: Loaded', this.clients.length, 'clients');
        } else {
          console.log('No clients found for this trainer');
          this.clients = [];
        }
      }, (error) => {
        console.error('Error listening to trainer clients:', error);
        this.clients = [];
      });
    } catch (error) {
      console.error('Error setting up real-time listener:', error);
      this.clients = [];
    }
  }

  async calculateRevenueFromBookings(trainerId: string) {
    try {
      const today = new Date();
      this.monthlyRevenue = [];
      this.totalRevenue = 0;
      
      // Query all bookings for this trainer
      const bookingsRef = collection(this.firestore, 'bookings');
      const q = query(bookingsRef, where('trainerId', '==', trainerId));
      const querySnapshot = await getDocs(q);
      
      // Group bookings by month
      const revenueByMonth = new Map<string, { revenue: number; sessions: number }>();
      
      querySnapshot.forEach((doc) => {
        const booking = doc.data() as any;
        
        // Only count completed or confirmed sessions
        if (booking.status === 'completed' || booking.status === 'confirmed') {
          const bookingDate = new Date(booking.startTimeUTC || booking.createdAt?.toDate() || new Date());
          const monthKey = `${bookingDate.getFullYear()}-${bookingDate.getMonth()}`;
          const price = booking.price || 75; // Default to $75 if no price set
          
          if (!revenueByMonth.has(monthKey)) {
            revenueByMonth.set(monthKey, { revenue: 0, sessions: 0 });
          }
          
          const monthData = revenueByMonth.get(monthKey)!;
          monthData.revenue += price;
          monthData.sessions += 1;
        }
      });
      
      // Generate monthly revenue data for last 3 months and next 2 months
      for (let i = -3; i <= 2; i++) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const monthKey = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
        const monthStats = revenueByMonth.get(monthKey) || { revenue: 0, sessions: 0 };
        
        this.monthlyRevenue.push({
          month: monthDate,
          revenue: monthStats.revenue,
          sessions: monthStats.sessions,
          isPast: i < 0,
          isCurrent: i === 0,
          isFuture: i > 0
        });
        
        // Only add to total revenue for past and current months
        if (i <= 0) {
          this.totalRevenue += monthStats.revenue;
        }
      }
      
      this.currentMonthIndex = 3; // Current month is at index 3
      console.log('💰 Revenue calculated from bookings:', this.totalRevenue);
      
    } catch (error) {
      console.error('Error calculating revenue:', error);
      // Fallback to empty revenue if query fails
      this.monthlyRevenue = [];
      this.totalRevenue = 0;
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
    const clientId = this.auth.currentUser?.uid;
    if (!clientId) return;

    try {
      // Load home page customization
      const configRef = doc(this.firestore, `clientHomeConfigs/${clientId}`);
      const configSnap = await getDoc(configRef);
      
      if (configSnap.exists()) {
        this.homeConfig = configSnap.data() as HomePageConfig;
        this.customMessage = this.homeConfig.customMessage || '';
        console.log('Loaded home page configuration:', this.homeConfig);
      }

      // Load client profile to get streak data
      const clientRef = doc(this.firestore, `clients/${clientId}`);
      const clientSnap = await getDoc(clientRef);
      
      if (clientSnap.exists()) {
        const clientData = clientSnap.data();
        this.currentStreak = clientData['currentStreak'] || 0;
        console.log('📊 Current streak:', this.currentStreak);
      }

      // Load next scheduled workout
      await this.loadNextWorkout(clientId);

      // Load upcoming trainer sessions from bookings
      await this.loadUpcomingSessions(clientId);

    } catch (error) {
      console.error('Error loading client data:', error);
    }
  }

  async loadNextWorkout(clientId: string) {
    try {
      // Query for next scheduled workout
      const workoutsRef = collection(this.firestore, `clientWorkouts/${clientId}/workouts`);
      const q = query(
        workoutsRef,
        where('scheduledDate', '>=', Timestamp.now()),
        where('isComplete', '==', false)
      );
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        // Get the first upcoming workout
        const workoutDoc = querySnapshot.docs[0];
        const workoutData = workoutDoc.data();
        
        this.nextWorkout = {
          title: workoutData['title'] || 'Workout',
          date: workoutData['scheduledDate']?.toDate() || new Date(),
          type: workoutData['type'] || 'Training',
          duration: workoutData['duration'] || 60,
          exercises: workoutData['exercises'] || [],
          notes: workoutData['notes'] || ''
        };
        
        console.log('📅 Next workout loaded:', this.nextWorkout.title);
      } else {
        this.nextWorkout = null;
        console.log('No upcoming workouts scheduled');
      }
    } catch (error) {
      console.error('Error loading next workout:', error);
      this.nextWorkout = null;
    }
  }

  async loadUpcomingSessions(clientId: string) {
    try {
      // Query bookings for this client
      const bookingsRef = collection(this.firestore, 'bookings');
      const q = query(
        bookingsRef,
        where('clientId', '==', clientId),
        where('status', 'in', ['confirmed', 'pending'])
      );
      
      const querySnapshot = await getDocs(q);
      
      this.upcomingSessions = [];
      const now = new Date();
      
      querySnapshot.forEach((doc) => {
        const booking = doc.data();
        const sessionDate = new Date(booking['startTimeUTC']);
        
        // Only include future sessions
        if (sessionDate > now) {
          this.upcomingSessions.push({
            id: doc.id,
            trainerName: `${booking['trainerFirstName'] || ''} ${booking['trainerLastName'] || ''}`.trim() || 'Trainer',
            date: sessionDate,
            notes: booking['notes'] || '',
            duration: booking['duration'] || 60
          });
        }
      });
      
      // Sort by date (earliest first)
      this.upcomingSessions.sort((a, b) => a.date.getTime() - b.date.getTime());
      
      console.log('📆 Loaded', this.upcomingSessions.length, 'upcoming sessions');
    } catch (error) {
      console.error('Error loading upcoming sessions:', error);
      this.upcomingSessions = [];
    }
  }

  // Helper methods from main branch
  get greetingName(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const user = (this.currentUser?.username || '').trim();
    return first || user || 'there';
  }

  // Trainer-specific helper methods
  viewClientDetails(client: any) {
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

  // Generic navigation
  navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  startWorkout() {
    this.router.navigate(['/tabs/chats/workout-chatbot']);
  }

  viewStreak() {
    console.log('Viewing streak...');
  }

  viewNextWorkout() {
    if (this.nextWorkout) {
      console.log('Viewing next workout:', this.nextWorkout);
    }
  }

  viewSessionDetails(session: UpcomingSession) {
    console.log('Viewing session:', session);
  }
}
