import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  AlertController,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
  ModalController,
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
import { Firestore, collection, getDoc, onSnapshot, doc, query, where, getDocs, Timestamp, limit, deleteDoc, orderBy } from '@angular/fire/firestore';
import { authState } from 'rxfire/auth';
import { from, of, switchMap } from 'rxjs';
import { Subscription } from 'rxjs';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { AppointmentSchedulerModalComponent } from 'src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component';
import { normalizeStreakData } from '../../models/user-stats.model';
import { UserService } from '../../services/account/user.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';
import { SessionBookingService } from '../../services/session-booking.service';
import { TrainerConnectionService } from '../../services/trainer-connection.service';
import { ROUTE_PATHS } from '../../app.routes';

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
  trainerProfilePic?: string;
  date: Date;
  notes?: string;
  duration: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
}

interface PendingClientRequest {
  clientId: string;
  clientName: string;
  clientProfilepic: string;
  message: string;
}

interface PendingSessionRequest {
  bookingId: string;
  clientId: string;
  clientName: string;
  clientProfilePic: string;
  date: Date;
  timeLabel: string;
  duration: number;
  sessionType: string;
  notes: string;
}

interface RevenueMonthSummary {
  month: Date;
  revenue: number;
  payments: number;
  isPast: boolean;
  isCurrent: boolean;
  isFuture: boolean;
}

interface RevenueLedgerEntry {
  dedupeKey: string;
  amount: number;
  date: Date;
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
  private sessionBookingService = inject(SessionBookingService);
  private trainerConnectionService = inject(TrainerConnectionService);
  private alertController = inject(AlertController);
  private modalController = inject(ModalController);

  private userSub?: Subscription;
  private trainerClientsUnsubscribe: (() => void) | null = null;
  private trainerRequestsUnsubscribe: (() => void) | null = null;
  private trainerSessionRequestsUnsubscribe: (() => void) | null = null;
  private userSummaryUnsubscribe: (() => void) | null = null;
  private clientUserStatsUnsubscribe: (() => void) | null = null;
  private currentSummaryUid: string | null = null;
  private currentClientStatsUid: string | null = null;
  private activeUserDataKey: string | null = null;
  private isReconcilingTrainerClients = false;

  isLoadingUser = true;
  currentUser: AppUser | null = null;
  
  // Trainer-specific data
  clients: any[] = [];
  pendingClientRequests: PendingClientRequest[] = [];
  pendingSessionRequests: PendingSessionRequest[] = [];
  currentMonthIndex = 0;
  monthlyRevenue: RevenueMonthSummary[] = [];
  totalRevenue = 0;
  
  // Client-specific data
  currentStreak = 0;
  nextWorkout: NextWorkout | null = null;
  upcomingSessions: UpcomingSession[] = [];
  assignedTrainerId = '';
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
      personCircle,
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
          this.stopTrainerRequestsListener();
          this.stopTrainerSessionRequestsListener();
          this.stopCurrentUserSummaryListener();
          this.stopClientUserStatsListener();
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
          this.stopClientUserStatsListener();
          this.startTrainerRequestsListener(userId);
          this.startTrainerSessionRequestsListener(userId);
          void this.loadTrainerClients(userId);
        } else {
          this.stopTrainerClientsListener();
          this.stopTrainerRequestsListener();
          this.stopTrainerSessionRequestsListener();
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

  private startClientUserStatsListener(clientId: string): void {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      this.stopClientUserStatsListener();
      return;
    }

    if (
      this.clientUserStatsUnsubscribe &&
      this.currentClientStatsUid === normalizedClientId
    ) {
      return;
    }

    this.stopClientUserStatsListener();
    this.currentClientStatsUid = normalizedClientId;
    const roleKey = `${normalizedClientId}:client`;
    const userStatsRef = doc(this.firestore, 'userStats', normalizedClientId);
    this.clientUserStatsUnsubscribe = onSnapshot(
      userStatsRef,
      (snapshot) => {
        if (this.activeUserDataKey !== roleKey) {
          return;
        }

        const userStatsData = snapshot.exists()
          ? (snapshot.data() as Record<string, unknown>)
          : null;
        this.currentStreak = userStatsData
          ? normalizeStreakData(
              userStatsData['streakData'],
              userStatsData['currentStreak'],
              userStatsData['maxStreak']
            ).currentStreak
          : 0;
      },
      (error) => {
        console.error('Error listening to client userStats:', error);
      }
    );
  }

  private stopClientUserStatsListener(): void {
    this.clientUserStatsUnsubscribe?.();
    this.clientUserStatsUnsubscribe = null;
    this.currentClientStatsUid = null;
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
    this.stopTrainerClientsListener();
    this.stopTrainerRequestsListener();
    this.stopTrainerSessionRequestsListener();
    this.stopCurrentUserSummaryListener();
    this.stopClientUserStatsListener();
  }

  ionViewWillEnter(): void {
    if (this.currentUser && !this.currentUser.isPT) {
      const clientId = this.currentUser.userId;
      if (clientId) {
        void this.loadClientData(clientId);
      }
    }
  }

  private stopTrainerClientsListener(): void {
    this.trainerClientsUnsubscribe?.();
    this.trainerClientsUnsubscribe = null;
  }

  private startTrainerRequestsListener(trainerId: string): void {
    const normalizedTrainerId = String(trainerId || '').trim();
    if (!normalizedTrainerId) {
      this.stopTrainerRequestsListener();
      return;
    }

    this.stopTrainerRequestsListener();
    const requestsRef = collection(this.firestore, `trainers/${normalizedTrainerId}/clientRequests`);
    this.trainerRequestsUnsubscribe = onSnapshot(
      requestsRef,
      (snapshot) => {
        if (this.activeUserDataKey !== `${normalizedTrainerId}:trainer`) {
          return;
        }

        this.pendingClientRequests = snapshot.docs
          .map((requestDoc) => {
            const requestData = requestDoc.data() as Record<string, unknown>;
            if (String(requestData['status'] || '').trim() !== 'pending') {
              return null;
            }

            return {
              clientId: requestDoc.id,
              clientName: String(requestData['clientName'] || '').trim() || 'Client',
              clientProfilepic: String(requestData['clientProfilepic'] || '').trim(),
              message: String(requestData['message'] || '').trim(),
            } as PendingClientRequest;
          })
          .filter((request): request is PendingClientRequest => !!request)
          .sort((a, b) => a.clientName.localeCompare(b.clientName));
      },
      (error) => {
        console.error('Error listening to trainer connection requests:', error);
        this.pendingClientRequests = [];
      }
    );
  }

  private stopTrainerRequestsListener(): void {
    this.trainerRequestsUnsubscribe?.();
    this.trainerRequestsUnsubscribe = null;
    this.pendingClientRequests = [];
  }

  private startTrainerSessionRequestsListener(trainerId: string): void {
    const normalizedTrainerId = String(trainerId || '').trim();
    if (!normalizedTrainerId) {
      this.stopTrainerSessionRequestsListener();
      return;
    }

    this.stopTrainerSessionRequestsListener();
    const bookingsRef = collection(this.firestore, 'bookings');
    const trainerPendingBookingsQuery = query(
      bookingsRef,
      where('trainerId', '==', normalizedTrainerId),
      where('status', '==', 'pending')
    );

    this.trainerSessionRequestsUnsubscribe = onSnapshot(
      trainerPendingBookingsQuery,
      (snapshot) => {
        if (this.activeUserDataKey !== `${normalizedTrainerId}:trainer`) {
          return;
        }

        this.pendingSessionRequests = snapshot.docs
          .map((bookingDoc) => {
            const bookingData = bookingDoc.data() as Record<string, unknown>;
            if (String(bookingData['requestedBy'] || '').trim() !== 'client') {
              return null;
            }

            const date = this.parseSessionDateTime(bookingData);
            if (!date) {
              return null;
            }

            const clientFirstName = String(bookingData['clientFirstName'] || '').trim();
            const clientLastName = String(bookingData['clientLastName'] || '').trim();

            return {
              bookingId: bookingDoc.id,
              clientId: String(bookingData['clientId'] || '').trim(),
              clientName: `${clientFirstName} ${clientLastName}`.trim() || 'Client',
              clientProfilePic: String(bookingData['clientProfilePic'] || '').trim(),
              date,
              timeLabel: String(bookingData['time'] || '').trim(),
              duration: Number(bookingData['duration'] || 60) || 60,
              sessionType: String(bookingData['sessionType'] || '').trim() || 'Training Session',
              notes: String(bookingData['notes'] || '').trim(),
            } as PendingSessionRequest;
          })
          .filter((request): request is PendingSessionRequest => !!request)
          .sort((a, b) => a.date.getTime() - b.date.getTime());
      },
      (error) => {
        console.error('Error listening to trainer session requests:', error);
        this.pendingSessionRequests = [];
      }
    );
  }

  private stopTrainerSessionRequestsListener(): void {
    this.trainerSessionRequestsUnsubscribe?.();
    this.trainerSessionRequestsUnsubscribe = null;
    this.pendingSessionRequests = [];
  }

  private clearRoleData(): void {
    this.stopClientUserStatsListener();
    this.clients = [];
    this.pendingClientRequests = [];
    this.pendingSessionRequests = [];
    this.monthlyRevenue = [];
    this.totalRevenue = 0;
    this.currentStreak = 0;
    this.nextWorkout = null;
    this.upcomingSessions = [];
    this.assignedTrainerId = '';
    this.homeConfig = null;
    this.customMessage = '';
    this.currentMonthIndex = 0;
  }

  private coerceDate(value: unknown, fallback?: Date): Date | null {
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

    return fallback ?? null;
  }

  private parseSessionDateTime(session: Record<string, unknown>): Date | null {
    const startTimeUTC = String(session['startTimeUTC'] || '').trim();
    if (startTimeUTC) {
      const utcDate = new Date(startTimeUTC);
      if (!Number.isNaN(utcDate.getTime())) {
        return utcDate;
      }
    }

    const date = String(session['date'] || '').trim();
    const time = String(session['time'] || session['startTime'] || '').trim();
    if (!date) {
      return null;
    }

    const combined = new Date(`${date} ${time}`.trim());
    if (!Number.isNaN(combined.getTime())) {
      return combined;
    }

    const dateOnly = new Date(date);
    if (!Number.isNaN(dateOnly.getTime())) {
      return dateOnly;
    }

    return null;
  }

  private async getTrainerNextSessionByClient(trainerId: string): Promise<Map<string, Date>> {
    const nextSessionByClient = new Map<string, Date>();

    try {
      const bookedSessions = await this.sessionBookingService.getTrainerBookedSessions(trainerId);
      const now = Date.now();

      for (const session of bookedSessions) {
        const clientId = String(session?.['clientId'] || '').trim();
        if (
          !clientId ||
          session?.['status'] === 'cancelled' ||
          session?.['status'] === 'pending'
        ) {
          continue;
        }

        const sessionDate = this.parseSessionDateTime(session as Record<string, unknown>);
        if (!sessionDate || sessionDate.getTime() <= now) {
          continue;
        }

        const existing = nextSessionByClient.get(clientId);
        if (!existing || sessionDate.getTime() < existing.getTime()) {
          nextSessionByClient.set(clientId, sessionDate);
        }
      }
    } catch (error) {
      console.error('[HomePage] Error deriving next sessions from trainer bookings:', error);
    }

    return nextSessionByClient;
  }

  async loadTrainerClients(trainerId: string) {
    if (!trainerId) return;

    // Load revenue data in parallel, don't block client list loading
    void this.calculateRevenueFromStripeData(trainerId);

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
        const nextSessionByClient = await this.getTrainerNextSessionByClient(trainerId);
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
              nextSession: nextSessionByClient.get(clientId) ?? this.coerceDate(client['nextSession']),
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
            const clientProfileSnap = await getDoc(doc(this.firestore, `clients/${clientId}`));
            if (!clientProfileSnap.exists()) {
              return { clientDocId, shouldRemove: true };
            }

            const assignedTrainerId = String(
              (clientProfileSnap.data() as Record<string, unknown>)['trainerId'] || ''
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

  async calculateRevenueFromStripeData(trainerId: string) {
    try {
      const today = new Date();
      const monthlyRevenue: RevenueMonthSummary[] = [];

      const revenueEntries = await this.readTrainerStripeRevenueEntries(trainerId);
      const totalRevenue = revenueEntries.reduce((sum, entry) => sum + entry.amount, 0);
      const revenueByMonth = new Map<string, { revenue: number; payments: number }>();

      for (const entry of revenueEntries) {
        const monthKey = `${entry.date.getFullYear()}-${entry.date.getMonth()}`;
        if (!revenueByMonth.has(monthKey)) {
          revenueByMonth.set(monthKey, { revenue: 0, payments: 0 });
        }

        const monthData = revenueByMonth.get(monthKey)!;
        monthData.revenue += entry.amount;
        monthData.payments += 1;
      }

      for (let i = -3; i <= 2; i++) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const monthKey = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
        const monthStats = revenueByMonth.get(monthKey) || { revenue: 0, payments: 0 };

        monthlyRevenue.push({
          month: monthDate,
          revenue: monthStats.revenue,
          payments: monthStats.payments,
          isPast: i < 0,
          isCurrent: i === 0,
          isFuture: i > 0
        });
      }

      if (this.activeUserDataKey !== `${trainerId}:trainer`) {
        return;
      }

      this.monthlyRevenue = monthlyRevenue;
      this.totalRevenue = totalRevenue;
      this.currentMonthIndex = 3;
      
    } catch (error) {
      console.error('Error calculating Stripe revenue:', error);
      if (this.activeUserDataKey === `${trainerId}:trainer`) {
        this.monthlyRevenue = [];
        this.totalRevenue = 0;
      }
    }
  }

  private async readTrainerStripeRevenueEntries(trainerId: string): Promise<RevenueLedgerEntry[]> {
    const [transactionsSnapshot, checkoutSessionsSnapshot] = await Promise.all([
      getDocs(query(collection(this.firestore, 'transactions'), where('trainerId', '==', trainerId))),
      getDocs(query(collection(this.firestore, 'checkoutSessions'), where('trainerId', '==', trainerId))),
    ]);

    const entries: RevenueLedgerEntry[] = [];
    const seenKeys = new Set<string>();

    for (const transactionDoc of transactionsSnapshot.docs) {
      const transaction = transactionDoc.data() as Record<string, unknown>;
      const status = String(transaction['status'] || '').trim().toLowerCase();
      if (!this.isSuccessfulStripePaymentStatus(status)) {
        continue;
      }

      const amount = this.resolveStripeAmount(transaction);
      if (amount <= 0) {
        continue;
      }

      const date =
        this.coerceDate(transaction['createdAt']) ||
        this.coerceDate(transaction['date']) ||
        this.coerceDate(transaction['timestamp']) ||
        this.coerceDate(transaction['paidAt']) ||
        this.coerceDate(transaction['updatedAt']);
      if (!date) {
        continue;
      }

      const dedupeKey = this.resolveRevenueDedupeKey(transaction, transactionDoc.id, 'txn');
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      entries.push({ dedupeKey, amount, date });
    }

    for (const checkoutSessionDoc of checkoutSessionsSnapshot.docs) {
      const checkoutSession = checkoutSessionDoc.data() as Record<string, unknown>;
      const stripeStatus = String(checkoutSession['stripeStatus'] || '').trim().toLowerCase();
      if (!this.isSuccessfulStripePaymentStatus(stripeStatus)) {
        continue;
      }

      const amount = this.resolveStripeAmount(checkoutSession);
      if (amount <= 0) {
        continue;
      }

      const date =
        this.coerceDate(checkoutSession['createdAt']) ||
        this.coerceDate(checkoutSession['updatedAt']);
      if (!date) {
        continue;
      }

      const dedupeKey = this.resolveRevenueDedupeKey(checkoutSession, checkoutSessionDoc.id, 'checkout');
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      entries.push({ dedupeKey, amount, date });
    }

    return entries;
  }

  private isSuccessfulStripePaymentStatus(status: string): boolean {
    return status === 'paid' ||
      status === 'succeeded' ||
      status === 'complete' ||
      status === 'completed';
  }

  private resolveRevenueDedupeKey(
    record: Record<string, unknown>,
    fallbackId: string,
    source: 'txn' | 'checkout'
  ): string {
    const checkoutSessionId =
      String(record['checkoutSessionId'] || '').trim() ||
      String(record['stripeCheckoutSessionId'] || '').trim();
    if (checkoutSessionId) {
      return `checkout:${checkoutSessionId}`;
    }

    const paymentIntentId =
      String(record['paymentIntentId'] || '').trim() ||
      String(record['stripePaymentIntentId'] || '').trim();
    if (paymentIntentId) {
      return `paymentIntent:${paymentIntentId}`;
    }

    const chargeId = String(record['stripeChargeId'] || '').trim();
    if (chargeId) {
      return `charge:${chargeId}`;
    }

    return `${source}:${fallbackId}`;
  }

  private resolveStripeAmount(record: Record<string, unknown>): number {
    const centsAmount = this.toFiniteNumber(record['priceCents']) ??
      this.toFiniteNumber(record['amountCents']) ??
      this.toFiniteNumber(record['unitAmountCents']) ??
      this.toFiniteNumber(record['unit_amount']) ??
      this.toFiniteNumber(record['amount_total']);
    if (centsAmount !== null && centsAmount > 0) {
      return centsAmount / 100;
    }

    const dollarAmount = this.toFiniteNumber(record['amount']) ??
      this.toFiniteNumber(record['total']) ??
      this.toFiniteNumber(record['price']);
    if (dollarAmount === null || dollarAmount <= 0) {
      return 0;
    }

    return dollarAmount;
  }

  private toFiniteNumber(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
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
      this.startClientUserStatsListener(clientId);
      const configRef = doc(this.firestore, `clientHomeConfigs/${clientId}`);
      const clientProfileRef = doc(this.firestore, `clients/${clientId}`);
      const [configSnap, clientProfileSnap] = await Promise.all([
        getDoc(configRef),
        getDoc(clientProfileRef),
      ]);
      
      if (configSnap.exists() && this.activeUserDataKey === roleKey) {
        this.homeConfig = configSnap.data() as HomePageConfig;
        this.customMessage = this.homeConfig.customMessage || '';
      }

      if (this.activeUserDataKey === roleKey) {
        const clientProfileData = clientProfileSnap.exists()
          ? (clientProfileSnap.data() as Record<string, unknown>)
          : {};
        this.assignedTrainerId = String(
          clientProfileData['trainerId'] || this.currentUser?.trainerId || ''
        ).trim();

        if (this.currentUser) {
          this.currentUser = {
            ...this.currentUser,
            trainerId: this.assignedTrainerId,
          };
        }
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
        orderBy('scheduledDate', 'asc'),
        limit(1)
      );
      
      const querySnapshot = await getDocs(q);
      const roleKey = `${clientId}:client`;
      if (this.activeUserDataKey !== roleKey) {
        return;
      }
      
      if (!querySnapshot.empty) {
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

      const trainerProfilePicCache = new Map<string, string>();
      const upcomingSessions = await Promise.all(
        querySnapshot.docs.map(async (bookingDoc) => {
          const booking = bookingDoc.data();

          // Parse the date and time to create a proper Date object
          let sessionDate = now;
          try {
            const dateStr = booking['date']; // YYYY-MM-DD
            const timeStr = booking['time']; // HH:MM AM/PM

            if (dateStr && timeStr) {
              // Parse date parts
              const [year, month, day] = dateStr
                .split('-')
                .map((n: string) => parseInt(n, 10));

              // Parse time
              const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
              if (timeMatch) {
                let hours = parseInt(timeMatch[1], 10);
                const minutes = parseInt(timeMatch[2], 10);
                const period = timeMatch[3].toUpperCase();

                // Convert to 24-hour format
                if (period === 'PM' && hours < 12) hours += 12;
                else if (period === 'AM' && hours === 12) hours = 0;

                sessionDate = new Date(year, month - 1, day, hours, minutes);
              }
            }
          } catch (error) {
            console.error('Error parsing booking date/time:', error);
          }

          if (sessionDate <= now) {
            return null;
          }

          const trainerId = String(booking['trainerId'] || '').trim();
          let trainerProfilePic = String(
            booking['trainerProfilePic'] || booking['trainerProfilepic'] || ''
          ).trim();

          if (!trainerProfilePic && trainerId) {
            if (trainerProfilePicCache.has(trainerId)) {
              trainerProfilePic = trainerProfilePicCache.get(trainerId) || '';
            } else {
              try {
                const trainerSummary = await this.userService.getUserSummaryDirectly(trainerId);
                trainerProfilePic = String(trainerSummary?.profilepic || '').trim();
              } catch (error) {
                console.warn('Error loading trainer profile pic for session:', error);
              }
              trainerProfilePicCache.set(trainerId, trainerProfilePic);
            }
          }

          return {
            id: bookingDoc.id,
            trainerName:
              `${booking['trainerFirstName'] || ''} ${booking['trainerLastName'] || ''}`.trim() ||
              'Trainer',
            trainerProfilePic,
            date: sessionDate,
            notes: booking['notes'] || '',
            duration: booking['duration'] || 60,
            status: (booking['status'] || 'confirmed') as UpcomingSession['status'],
          } as UpcomingSession;
        })
      );

      if (this.activeUserDataKey !== roleKey) {
        return;
      }

      this.upcomingSessions = upcomingSessions
        .filter((session): session is UpcomingSession => !!session)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
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

  async removeClient(client: any, event?: Event): Promise<void> {
    event?.stopPropagation();

    const trainerId = String(this.currentUser?.userId || '').trim();
    const clientId = String(client?.id || '').trim();
    if (!trainerId || !clientId) {
      return;
    }

    const reason = await this.promptForClientRemovalReason(client);
    if (reason === null) {
      return;
    }

    try {
      await this.trainerConnectionService.removeConnectionByTrainer(clientId, trainerId, reason);
      this.clients = this.clients.filter((existingClient) => String(existingClient?.id || '').trim() !== clientId);
      await this.loadTrainerClients(trainerId);
    } catch (error) {
      console.error('Error removing client:', error);
    }
  }

  async approveClientRequest(request: PendingClientRequest, event?: Event): Promise<void> {
    event?.stopPropagation();
    const trainerId = String(this.currentUser?.userId || '').trim();
    if (!trainerId || !request.clientId) {
      return;
    }

    try {
      await this.trainerConnectionService.acceptConnectionRequest(trainerId, request.clientId);
      this.pendingClientRequests = this.pendingClientRequests.filter(
        (pendingRequest) => pendingRequest.clientId !== request.clientId
      );
      await this.loadTrainerClients(trainerId);
    } catch (error) {
      console.error('Error approving client request:', error);
    }
  }

  async declineClientRequest(request: PendingClientRequest, event?: Event): Promise<void> {
    event?.stopPropagation();
    const trainerId = String(this.currentUser?.userId || '').trim();
    if (!trainerId || !request.clientId) {
      return;
    }

    try {
      await this.trainerConnectionService.declineConnectionRequest(trainerId, request.clientId);
    } catch (error) {
      console.error('Error declining client request:', error);
    }
  }

  viewClientWorkoutVideos(client: any, event?: Event): void {
    event?.stopPropagation();

    const clientId = String(client?.id || client?.userId || '').trim();
    if (!clientId) {
      return;
    }

    const clientName = String(client?.name || '').trim();
    this.router.navigate([`/trainer-client-videos/${clientId}`], {
      queryParams: clientName ? { clientName } : {},
    });
  }

  private async promptForClientRemovalReason(client: any): Promise<string | null> {
    const clientName = String(client?.name || 'this client').trim();
    const alert = await this.alertController.create({
      header: 'Remove Client',
      message: `Why are you removing ${clientName}?`,
      inputs: [
        {
          name: 'reason',
          type: 'textarea',
          placeholder: 'This reason will be saved for later review.',
          attributes: {
            maxlength: 300,
          },
        },
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Remove',
          handler: (value) => {
            const reason = String(value?.reason || '').trim();
            if (!reason) {
              return false;
            }
            return true;
          },
        },
      ],
    });

    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role === 'cancel') {
      return null;
    }

    const reason = String(data?.values?.reason || '').trim();
    return reason || null;
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

  openTrainerPaymentDashboard(): void {
    void this.router.navigateByUrl(ROUTE_PATHS.APP.TABS.STRIPE_SETUP);
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

  async requestSessionWithTrainer(): Promise<void> {
    const clientId = String(this.currentUser?.userId || '').trim();
    const trainerId = String(this.assignedTrainerId || this.currentUser?.trainerId || '').trim();
    if (!clientId || !trainerId) {
      return;
    }

    try {
      const [trainerSummary, trainerProfileSnap] = await Promise.all([
        this.userService.getUserSummaryDirectly(trainerId),
        getDoc(doc(this.firestore, 'trainers', trainerId)),
      ]);

      const trainerProfile = trainerProfileSnap.exists()
        ? (trainerProfileSnap.data() as Record<string, unknown>)
        : {};
      const trainerFirstName = String(trainerSummary?.firstName || trainerProfile['firstName'] || '').trim();
      const trainerLastName = String(trainerSummary?.lastName || trainerProfile['lastName'] || '').trim();
      const trainerName = `${trainerFirstName} ${trainerLastName}`.trim() || 'Your Trainer';
      const clientFirstName = String(this.currentUser?.firstName || '').trim();
      const clientLastName = String(this.currentUser?.lastName || '').trim();

      const modal = await this.modalController.create({
        component: AppointmentSchedulerModalComponent,
        componentProps: {
          mode: 'client-request',
          trainerId,
          trainerName,
          trainerFirstName,
          trainerLastName,
          trainerProfilePic: String(trainerSummary?.profilepic || trainerProfile['profilepic'] || '').trim(),
          clientId,
          clientName: `${clientFirstName} ${clientLastName}`.trim() || this.userName(),
          clientFirstName,
          clientLastName,
          clientProfilePic: String(this.currentUser?.profilepic || '').trim(),
        },
      });

      await modal.present();
      const { data } = await modal.onWillDismiss();
      if (data?.success) {
        await this.loadUpcomingSessions(clientId);
      }
    } catch (error) {
      console.error('Error opening session request modal:', error);
    }
  }

  viewStreak() {}

  viewNextWorkout() {
    if (!this.nextWorkout) return;
  }

  viewSessionDetails(_session: UpcomingSession) {}

  async cancelSessionRequest(session: UpcomingSession, event?: Event): Promise<void> {
    event?.stopPropagation();

    const clientId = String(this.currentUser?.userId || '').trim();
    const bookingId = String(session?.id || '').trim();
    if (!clientId || !bookingId || session.status !== 'pending') {
      return;
    }

    const alert = await this.alertController.create({
      header: 'Cancel Session Request',
      message: `Cancel your pending session request with ${session.trainerName || 'your trainer'}?`,
      buttons: [
        {
          text: 'Keep Request',
          role: 'cancel',
        },
        {
          text: 'Cancel Request',
          role: 'destructive',
        },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') {
      return;
    }

    try {
      await this.sessionBookingService.cancelPendingBookingRequestByClient(clientId, bookingId);
      this.upcomingSessions = this.upcomingSessions.filter(
        (upcomingSession) => String(upcomingSession?.id || '').trim() !== bookingId
      );
      await this.loadUpcomingSessions(clientId);
    } catch (error) {
      console.error('Error cancelling session request:', error);
    }
  }

  async approveSessionRequest(request: PendingSessionRequest, event?: Event): Promise<void> {
    event?.stopPropagation();
    const trainerId = String(this.currentUser?.userId || '').trim();
    if (!trainerId || !request.bookingId) {
      return;
    }

    try {
      await this.sessionBookingService.acceptPendingBookingRequest(trainerId, request.bookingId);
      this.pendingSessionRequests = this.pendingSessionRequests.filter(
        (pendingRequest) => pendingRequest.bookingId !== request.bookingId
      );
      await this.loadTrainerClients(trainerId);
    } catch (error) {
      console.error('Error approving session request:', error);
    }
  }

  async declineSessionRequest(request: PendingSessionRequest, event?: Event): Promise<void> {
    event?.stopPropagation();
    const trainerId = String(this.currentUser?.userId || '').trim();
    if (!trainerId || !request.bookingId) {
      return;
    }

    try {
      await this.sessionBookingService.rejectPendingBookingRequest(trainerId, request.bookingId);
      this.pendingSessionRequests = this.pendingSessionRequests.filter(
        (pendingRequest) => pendingRequest.bookingId !== request.bookingId
      );
    } catch (error) {
      console.error('Error declining session request:', error);
    }
  }
}
