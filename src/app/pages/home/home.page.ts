import { Component, OnDestroy, OnInit, inject } from '@angular/core';
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
import { Firestore, collection, getDoc, onSnapshot, doc, query, where, getDocs, Timestamp, limit, deleteDoc } from '@angular/fire/firestore';
import { authState } from 'rxfire/auth';
import { from, of, switchMap } from 'rxjs';
import { Subscription } from 'rxjs';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { UserService } from '../../services/account/user.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';

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
  private userService = inject(UserService);
  private profileRepository = inject(ProfileRepositoryService);

  private userSub?: Subscription;
  private trainerClientsUnsubscribe: (() => void) | null = null;
  private userSummaryUnsubscribe: (() => void) | null = null;
  private currentSummaryUid: string | null = null;
  private activeUserDataKey: string | null = null;
  private isReconcilingTrainerClients = false;

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

        return from(this.profileRepository.getResolvedAppUser(fbUser.uid));
      })
    ).subscribe({
      next: (u) => {
        const nextUser = (u as AppUser | null) ?? null;
        const nextUserKey = nextUser ? `${nextUser.userId}:${nextUser.isPT ? 'trainer' : 'client'}` : null;
        const roleChanged = nextUserKey !== this.activeUserDataKey;

        this.currentUser = nextUser;
        this.isLoadingUser = false;

        if (!this.currentUser) {
          this.activeUserDataKey = null;
          this.stopTrainerClientsListener();
          this.stopCurrentUserSummaryListener();
          this.clearRoleData();
          return;
        }

        this.startCurrentUserSummaryListener(this.currentUser.userId || '');

        if (!roleChanged) {
          return;
        }

        this.activeUserDataKey = nextUserKey;
        this.clearRoleData();
        const userId = this.currentUser.userId;
        if (!userId) {
          return;
        }

        if (this.currentUser.isPT === true) {
          void this.loadTrainerClients(userId);
        } else {
          this.stopTrainerClientsListener();
          void this.loadClientData(userId);
        }
      },
      error: (err) => {
        console.error(err);
        this.currentUser = null;
        this.isLoadingUser = false;
      },
    });
  }

  private startCurrentUserSummaryListener(uid: string): void {
    const normalizedUid = (uid || '').trim();
    if (!normalizedUid) {
      this.stopCurrentUserSummaryListener();
      return;
    }

    if (this.userSummaryUnsubscribe && this.currentSummaryUid === normalizedUid) {
      return;
    }

    this.stopCurrentUserSummaryListener();
    this.currentSummaryUid = normalizedUid;
    this.userSummaryUnsubscribe = this.profileRepository.observeUserSummary(
      normalizedUid,
      (userSummary) => {
        if (!userSummary || !this.currentUser || this.currentUser.userId !== normalizedUid) {
          return;
        }

        this.currentUser = {
          ...this.currentUser,
          ...userSummary,
          isPT: this.currentUser.isPT,
        };
      }
    );
  }

  private stopCurrentUserSummaryListener(): void {
    this.userSummaryUnsubscribe?.();
    this.userSummaryUnsubscribe = null;
    this.currentSummaryUid = null;
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
    this.stopTrainerClientsListener();
    this.stopCurrentUserSummaryListener();
  }

  private stopTrainerClientsListener(): void {
    this.trainerClientsUnsubscribe?.();
    this.trainerClientsUnsubscribe = null;
  }

  private clearRoleData(): void {
    this.clients = [];
    this.monthlyRevenue = [];
    this.totalRevenue = 0;
    this.currentStreak = 0;
    this.nextWorkout = null;
    this.upcomingSessions = [];
    this.homeConfig = null;
    this.customMessage = '';
    this.currentMonthIndex = 0;
  }

  private coerceDate(value: unknown, fallback: Date): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (value && typeof value === 'object' && typeof (value as any).toDate === 'function') {
      const converted = (value as any).toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const converted = new Date(value);
      if (!Number.isNaN(converted.getTime())) {
        return converted;
      }
    }

    return fallback;
  }

  async loadTrainerClients(trainerId: string) {
    if (!trainerId) return;

    // Load revenue data in parallel, don't block client list loading
    void this.calculateRevenueFromBookings(trainerId);

    this.stopTrainerClientsListener();

    try {
      const trainerClientsRef = collection(this.firestore, `trainers/${trainerId}/clients`);

      this.trainerClientsUnsubscribe = onSnapshot(trainerClientsRef, async (snapshot) => {
        if (this.activeUserDataKey !== `${trainerId}:trainer`) {
          return;
        }

        if (snapshot.empty) {
          this.clients = [];
          return;
        }

        const clientsData = snapshot.docs.map((clientDoc) => ({
          userId: clientDoc.id,
          ...(clientDoc.data() as any),
        }));

        const validClientsData = await this.reconcileTrainerClients(trainerId, clientsData);
        if (this.activeUserDataKey !== `${trainerId}:trainer`) {
          return;
        }

        const clientsWithProfilePics = await Promise.all(
          validClientsData.map(async (client: any) => {
            const clientId = String(client['clientId'] || client['userId'] || '').trim();
            let firstName = String(client['firstName'] || '').trim();
            let lastName = String(client['lastName'] || '').trim();
            const parsedTotalSessions = Number(client['totalSessions']);
            let profilepic = String(client['profilepic'] || '').trim();

            if ((!firstName || !lastName || !profilepic) && clientId) {
              try {
                const clientUser = await this.userService.getUserSummaryDirectly(clientId);
                if (!firstName) {
                  firstName = String(clientUser?.firstName || '').trim();
                }
                if (!lastName) {
                  lastName = String(clientUser?.lastName || '').trim();
                }
                if (!profilepic) {
                  profilepic = String(clientUser?.profilepic || '').trim();
                }
              } catch (error) {
                console.warn(`Failed to fetch profile pic for client ${clientId}:`, error);
              }
            }

            const fallbackName = String(client['clientName'] || '').trim();
            const displayName = `${firstName} ${lastName}`.trim() || fallbackName || 'Unknown Client';

            return {
              id: clientId,
              firstName,
              lastName,
              name: displayName,
              profilepic,
              nextSession: this.coerceDate(client['nextSession'], new Date(Date.now() + 86400000)),
              totalSessions: Number.isFinite(parsedTotalSessions) ? parsedTotalSessions : 0,
              lastWorkout: this.coerceDate(client['lastSession'], new Date(Date.now() - 172800000)),
            };
          }),
        );

        if (this.activeUserDataKey !== `${trainerId}:trainer`) {
          return;
        }

        this.clients = clientsWithProfilePics;
      }, (error) => {
        console.error('Error listening to trainer clients:', error);
        this.clients = [];
      });
    } catch (error) {
      console.error('Error setting up real-time listener:', error);
      this.clients = [];
    }
  }

  private async reconcileTrainerClients(trainerId: string, clientsData: any[]): Promise<any[]> {
    if (!clientsData.length) {
      return clientsData;
    }

    if (this.isReconcilingTrainerClients) {
      return clientsData;
    }

    this.isReconcilingTrainerClients = true;
    try {
      const validationResults = await Promise.all(
        clientsData.map(async (client) => {
          const clientDocId = String(client['userId'] || '').trim();
          const clientId = String(client['clientId'] || clientDocId).trim();
          if (!clientDocId || !clientId) {
            return { clientDocId, shouldRemove: true };
          }

          try {
            const clientProfile = await this.userService.getUserProfileDirectly(clientId, 'client');
            if (!clientProfile) {
              return { clientDocId, shouldRemove: true };
            }

            const assignedTrainerId = String(
              (clientProfile as unknown as Record<string, unknown>)['trainerId'] || ''
            ).trim();
            return { clientDocId, shouldRemove: assignedTrainerId !== trainerId };
          } catch (error) {
            console.warn(`[HomePage] Failed validating trainer-client link for ${clientId}:`, error);
            return { clientDocId, shouldRemove: false };
          }
        })
      );

      const staleClientDocIds = validationResults
        .filter((result) => result.shouldRemove && result.clientDocId)
        .map((result) => result.clientDocId);

      if (staleClientDocIds.length) {
        await Promise.all(
          staleClientDocIds.map((clientDocId) =>
            deleteDoc(doc(this.firestore, `trainers/${trainerId}/clients/${clientDocId}`))
          )
        );
      }

      const staleClientDocIdSet = new Set(staleClientDocIds);
      return clientsData.filter((client) => !staleClientDocIdSet.has(String(client['userId'] || '').trim()));
    } finally {
      this.isReconcilingTrainerClients = false;
    }
  }

  async calculateRevenueFromBookings(trainerId: string) {
    try {
      const today = new Date();
      const monthlyRevenue: any[] = [];
      let totalRevenue = 0;
      
      const bookingsRef = collection(this.firestore, 'bookings');
      const q = query(bookingsRef, where('trainerId', '==', trainerId));
      const querySnapshot = await getDocs(q);
      
      const revenueByMonth = new Map<string, { revenue: number; sessions: number }>();
      
      querySnapshot.forEach((doc) => {
        const booking = doc.data() as any;
        
        if (booking.status === 'completed' || booking.status === 'confirmed') {
          const bookingDate = new Date(booking.startTimeUTC || booking.createdAt?.toDate() || new Date());
          const monthKey = `${bookingDate.getFullYear()}-${bookingDate.getMonth()}`;
          const price = booking.price || 75;
          
          if (!revenueByMonth.has(monthKey)) {
            revenueByMonth.set(monthKey, { revenue: 0, sessions: 0 });
          }
          
          const monthData = revenueByMonth.get(monthKey)!;
          monthData.revenue += price;
          monthData.sessions += 1;
        }
      });
      
      for (let i = -3; i <= 2; i++) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const monthKey = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
        const monthStats = revenueByMonth.get(monthKey) || { revenue: 0, sessions: 0 };
        
        monthlyRevenue.push({
          month: monthDate,
          revenue: monthStats.revenue,
          sessions: monthStats.sessions,
          isPast: i < 0,
          isCurrent: i === 0,
          isFuture: i > 0
        });
        
        if (i <= 0) {
          totalRevenue += monthStats.revenue;
        }
      }

      if (this.activeUserDataKey !== `${trainerId}:trainer`) {
        return;
      }

      this.monthlyRevenue = monthlyRevenue;
      this.totalRevenue = totalRevenue;
      this.currentMonthIndex = 3;
      
    } catch (error) {
      console.error('Error calculating revenue:', error);
      if (this.activeUserDataKey === `${trainerId}:trainer`) {
        this.monthlyRevenue = [];
        this.totalRevenue = 0;
      }
    }
  }

  loadUserData() {
    const clientId = this.currentUser?.userId || this.auth.currentUser?.uid;
    if (clientId) {
      void this.loadClientData(clientId);
    }
  }
  
  isWidgetEnabled(widgetId: string): boolean {
    if (!this.homeConfig) {
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
  
  async loadClientData(clientId: string) {
    if (!clientId) return;
    const roleKey = `${clientId}:client`;

    try {
      const configRef = doc(this.firestore, `clientHomeConfigs/${clientId}`);
      const configSnap = await getDoc(configRef);
      
      if (configSnap.exists() && this.activeUserDataKey === roleKey) {
        this.homeConfig = configSnap.data() as HomePageConfig;
        this.customMessage = this.homeConfig.customMessage || '';
      }

      const clientProfile = await this.userService.getUserProfileDirectly(clientId, 'client');
      if (clientProfile && this.activeUserDataKey === roleKey) {
        this.currentStreak = Number(
          (clientProfile as unknown as Record<string, unknown>)['currentStreak'] || 0
        ) || 0;
      }

      await this.loadNextWorkout(clientId);
      await this.loadUpcomingSessions(clientId);

    } catch (error) {
      console.error('Error loading client data:', error);
    }
  }

  async loadNextWorkout(clientId: string) {
    try {
      const workoutsRef = collection(this.firestore, `clientWorkouts/${clientId}/workouts`);
      const q = query(
        workoutsRef,
        where('scheduledDate', '>=', Timestamp.now()),
        where('isComplete', '==', false),
        limit(10)
      );
      
      const querySnapshot = await getDocs(q);
      const roleKey = `${clientId}:client`;
      if (this.activeUserDataKey !== roleKey) {
        return;
      }
      
      if (!querySnapshot.empty) {
        const workoutDoc = querySnapshot.docs
          .sort((a, b) => {
            const aTime = a.data()['scheduledDate']?.toDate?.()?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
            const bTime = b.data()['scheduledDate']?.toDate?.()?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
            return aTime - bTime;
          })[0];
        const workoutData = workoutDoc.data();
        
        this.nextWorkout = {
          title: workoutData['title'] || 'Workout',
          date: workoutData['scheduledDate']?.toDate() || new Date(),
          type: workoutData['type'] || 'Training',
          duration: workoutData['duration'] || 60,
          exercises: workoutData['exercises'] || [],
          notes: workoutData['notes'] || ''
        };
      } else {
        this.nextWorkout = null;
      }
    } catch (error) {
      console.error('Error loading next workout:', error);
      this.nextWorkout = null;
    }
  }

  async loadUpcomingSessions(clientId: string) {
    try {
      const bookingsRef = collection(this.firestore, 'bookings');
      const q = query(
        bookingsRef,
        where('clientId', '==', clientId),
        where('status', 'in', ['confirmed', 'pending']),
        limit(20)
      );
      
      const querySnapshot = await getDocs(q);
      const roleKey = `${clientId}:client`;
      if (this.activeUserDataKey !== roleKey) {
        return;
      }
      
      this.upcomingSessions = [];
      const now = new Date();
      
      querySnapshot.forEach((doc) => {
        const booking = doc.data();
        const sessionDate = new Date(booking['startTimeUTC']);
        
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
      
      this.upcomingSessions.sort((a, b) => a.date.getTime() - b.date.getTime());
    } catch (error) {
      console.error('Error loading upcoming sessions:', error);
      this.upcomingSessions = [];
    }
  }

  get greetingName(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const user = (this.currentUser?.username || '').trim();
    return first || user || 'there';
  }

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

  navigateTo(path: string): void {
    const cleanedPath = path.startsWith('/') ? path : `/${path}`;
    this.router.navigateByUrl(cleanedPath);
  }

  startWorkout() {
    this.router.navigate(['/workout-chatbot']);
  }

  viewStreak() {}

  viewNextWorkout() {
    if (!this.nextWorkout) return;
  }

  viewSessionDetails(_session: UpcomingSession) {}
}
