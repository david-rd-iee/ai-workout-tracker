import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import {
  AlertController,
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
} from '@ionic/angular/standalone';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { addIcons } from 'ionicons';
import { analyticsOutline, chevronForwardOutline, gridOutline } from 'ionicons/icons';
import type { WorkoutHistoryDateGroup } from '../../models/workout-history.model';
import { WorkoutSummaryService } from '../../services/workout-summary.service';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-workout-history',
  standalone: true,
  templateUrl: './workout-history.page.html',
  styleUrls: ['./workout-history.page.scss'],
  imports: [
    CommonModule,
    HeaderComponent,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonIcon,
  ],
})
export class ClientSelfWorkoutHistoryPage implements OnInit {
  historyGroups: WorkoutHistoryDateGroup[] = [];
  isLoading = false;
  pageTitle = 'Workout History';
  backHref = '/profile-user';
  isDemoModeUser = false;
  private requestedUserId = '';
  private clientName = '';

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private route: ActivatedRoute,
    private router: Router,
    private workoutSummaryService: WorkoutSummaryService,
    private alertController: AlertController
  ) {
    addIcons({
      analyticsOutline,
      gridOutline,
      chevronForwardOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.isLoading = true;

    try {
      const requestedUserId = (this.route.snapshot.queryParamMap.get('userId') || '').trim();
      this.clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
      if (this.clientName) {
        this.pageTitle = `${this.clientName}'s History`;
      }

      const signedInUserId = await this.resolveCurrentUserId();
      const targetUserId = signedInUserId;
      if (!targetUserId) {
        this.historyGroups = [];
        return;
      }
      this.requestedUserId = targetUserId;
      this.isDemoModeUser = await this.resolveDemoMode(targetUserId);

      if (requestedUserId && requestedUserId !== signedInUserId) {
        console.warn(
          '[ClientSelfWorkoutHistoryPage] Ignoring query userId that does not match signed-in user.'
        );
      }

      const summaries = await this.workoutSummaryService.listRecentWorkoutSummaries(targetUserId, 20);
      this.historyGroups = summaries.map((summary) => this.workoutSummaryService.toHistoryGroup(summary));
    } catch (error) {
      console.error('Failed to load workout summaries:', error);
      this.historyGroups = [];
    } finally {
      this.isLoading = false;
    }
  }

  get emptyStateMessage(): string {
    if (this.isDemoModeUser) {
      return 'Complete a demo workout to see your history here.';
    }

    return 'No workouts saved yet.';
  }

  viewCsv(): void {
    void this.router.navigate(['/workout-history-csv'], {
      queryParams: {
        ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
      state: {
        historyGroups: this.historyGroups,
      },
    });
  }

  viewInsights(): void {
    void this.router.navigate(['/workout-insights'], {
      queryParams: {
        ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
    });
  }

  openSummary(date: string): void {
    void this.router.navigate(['/workout-summary'], {
      queryParams: {
        date,
        ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
      state: {
        backHref: '/workout-history',
        backQueryParams: {
          ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
          ...(this.clientName ? { clientName: this.clientName } : {}),
        },
      },
    });
  }

  async showHistoryInfo(): Promise<void> {
    const alert = await this.alertController.create({
      mode: 'ios',
      header: 'Workout history help',
      subHeader: 'Review and drill into past sessions',
      message: [
        '• Tap any day card to open the full workout summary.',
        '• Use Workout Insights for trend analysis.',
        '• Use View CSV to open spreadsheet-style history.'
      ].join('\n'),
      buttons: ['Got it'],
      translucent: true,
    });

    await alert.present();
  }

  private async resolveCurrentUserId(): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (currentUser?.uid) {
      return currentUser.uid;
    }

    const authUser = await new Promise<{ uid?: string } | null>((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth as never, (user) => {
        unsubscribe();
        resolve(user);
      });
    });

    return authUser?.uid?.trim() || '';
  }

  private async resolveDemoMode(userId: string): Promise<boolean> {
    try {
      const [userSnap, clientSnap] = await Promise.all([
        getDoc(doc(this.firestore, 'users', userId)),
        getDoc(doc(this.firestore, 'clients', userId)),
      ]);

      const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
      const clientData = clientSnap.exists() ? (clientSnap.data() as Record<string, unknown>) : {};

      return userData['demoMode'] === true || clientData['demoMode'] === true;
    } catch (error) {
      console.error('[ClientSelfWorkoutHistoryPage] Failed to resolve demo mode:', error);
      return false;
    }
  }
}
